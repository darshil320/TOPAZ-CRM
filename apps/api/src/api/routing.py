"""Route planning API — the multi-workshop journey of an order item (module 14).

    POST  /api/routing/items/{item_id}/route          plan (or re-plan) a route
          req  {legs:[{workshop_id, stage_from, stage_to, planned_days?, due_at?}],
                start_at?}  |  {template_id, start_at?}
          200  {legs:[...], activated_leg, assignment}
          403  caller may not plan this customer's production
          404  unknown item / unknown workshop / unknown template
          409  item finished · item in transit · order not confirmed|in_production ·
               work already started on a leg (use ?from_seq) · concurrent plan
          422  the plan does not tile the stage chain (gap/overlap/backwards/short)

    POST  /api/routing/items/{item_id}/reflow         owner/admin — audited due-date reflow
    GET   /api/routing/items/{item_id}/route          the leg timeline (money-blind)
    GET   /api/routing/templates                     route templates + their legs
    POST  /api/routing/templates                     owner/admin
    POST  /api/routing/templates/{id}/deactivate     owner/admin

Every structural decision (contiguity, direction, cover, cumulative deadlines) is made
by services/route_plan.py before a row is written — see that module's tests for the
exact rules and the messages the operator gets.

RE-PLANNING RULE: a route may be replaced from any leg whose work has not started.
Legs before the pivot are untouched history; open legs at or after it are CANCELLED
(never deleted — a leg that was active is a record of goods having been somewhere, and
consignment rows FK it).
"""

import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from ..database import get_api_session
from ..repositories import production_repo, route_repo
from ..services import route_plan, stage_flow
from ..services.route_plan import LegSpec, RoutePlanError
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/routing", dependencies=[Depends(require_dashboard_key)])

_ROUTABLE_ORDER_STATUSES = {"confirmed", "in_production"}


class LegInput(BaseModel):
    workshop_id: UUID
    stage_from: str = Field(min_length=1)
    stage_to: str = Field(min_length=1)
    planned_days: int | None = Field(default=None, ge=1, le=365)
    due_at: datetime | None = None


class RouteRequest(BaseModel):
    legs: list[LegInput] | None = None
    template_id: UUID | None = None
    start_at: datetime | None = None
    # Re-plan from this leg onwards. 1 = replace the whole route. Defaults to "the
    # first leg that has not been worked on", computed server-side.
    from_seq: int | None = Field(default=None, ge=1)


class ReflowRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
    from_seq: int | None = Field(default=None, ge=1)
    from_at: datetime | None = None


class TemplateLegInput(BaseModel):
    workshop_id: UUID
    stage_from: str = Field(min_length=1)
    stage_to: str = Field(min_length=1)
    planned_days: int = Field(ge=1, le=365)


class TemplateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    notes: str | None = None
    legs: list[TemplateLegInput] = Field(min_length=1)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


async def _assert_workshops_active(session, workshop_ids: list[str]) -> None:
    """Every workshop on the plan must exist and be active.

    Checked as a set in one query: the alternative (one round trip per leg) makes a
    five-leg route five chances to half-validate.
    """
    if not workshop_ids:
        return
    rows = await session.execute(
        text("SELECT id, name, active FROM workshops WHERE id = any(cast(:ids as uuid[]))"),
        {"ids": list({str(w) for w in workshop_ids})},
    )
    found = {str(r["id"]): dict(r) for r in rows.mappings().all()}
    for wid in workshop_ids:
        row = found.get(str(wid))
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"Workshop {wid} not found")
        if not row["active"]:
            raise _conflict(f"Workshop '{row['name']}' is inactive — pick another")


@router.get("/items/{order_item_id}/route")
async def get_route(order_item_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        state = await production_repo.item_production_state(session, order_item_id)
        if state is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Order item not found")
        caps = await authz.capabilities_at_workshop(
            session, caller, str(state["workshop_id"]) if state["workshop_id"] else None
        )
        if not caps:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Not authorized to view this item's route")
        legs = await route_repo.legs_for_item(session, order_item_id)
        stages = await production_repo.stage_defs(session)
    return {"order_item_id": str(order_item_id), "legs": legs, "stages": stages}


@router.post("/items/{order_item_id}/route")
async def plan_route(order_item_id: UUID, req: RouteRequest,
                     caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Plan the item's journey and activate leg 1 (or the first leg after the pivot).

    Activation goes through production_repo.allocate(), NOT a direct write, so the
    one-active-assignment invariant and the order_items.workshop_id denorm keep exactly
    one writer each (module 14 D5).
    """
    if req.legs is None and req.template_id is None:
        raise _unprocessable("Supply either `legs` or a `template_id`")
    if req.legs is not None and req.template_id is not None:
        raise _unprocessable("Supply `legs` or `template_id`, not both")

    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        caps = stage_flow.capabilities_for(role=caller.role, staff_role=None)
        if stage_flow.CAP_ALLOCATE not in caps:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Your role cannot plan production routes")

        item = await production_repo.lock_item_for_event(session, order_item_id)
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Order item not found")
        await authz.assert_can_write_customer(session, caller, str(item["customer_id"]))

        if item["order_status"] not in _ROUTABLE_ORDER_STATUSES:
            raise _conflict(f"Cannot route an order with status '{item['order_status']}'")
        if item["production_done_at"] is not None:
            raise _conflict("This item has already finished production")
        if item["transit_transfer_id"] is not None:
            raise _conflict(
                "This item is in transit — receive it at its destination before re-planning"
            )

        # ─── Resolve the plan input ───────────────────────────────────────────
        if req.template_id is not None:
            template_legs = await route_repo.get_template_legs(session, req.template_id)
            if not template_legs:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                    detail="Route template not found or has no legs")
            leg_inputs = [
                LegSpec(
                    workshop_id=str(t["workshop_id"]), stage_from=str(t["stage_from"]),
                    stage_to=str(t["stage_to"]), planned_days=t["planned_days"],
                )
                for t in template_legs
            ]
        else:
            leg_inputs = [
                LegSpec(
                    workshop_id=str(leg.workshop_id), stage_from=leg.stage_from,
                    stage_to=leg.stage_to, planned_days=leg.planned_days,
                    due_at=leg.due_at,
                )
                for leg in (req.legs or [])
            ]

        await _assert_workshops_active(session, [leg.workshop_id for leg in leg_inputs])

        # ─── Where does the new plan start? ───────────────────────────────────
        existing = await route_repo.lock_legs_for_item(session, order_item_id)
        worked = [
            leg for leg in existing
            if leg["status"] in ("active", "completed") or leg["activated_at"] is not None
        ]
        default_pivot = max((leg["seq"] for leg in worked), default=0) + 1
        pivot = req.from_seq or default_pivot
        if pivot < default_pivot:
            raise _conflict(
                f"Legs 1–{default_pivot - 1} have already been worked on — "
                f"re-plan from leg {default_pivot} or later"
            )

        stages = stage_flow.to_stages(await production_repo.stage_defs(session))
        if pivot == 1:
            # Fresh plan (or a full replacement): start where the item actually is.
            start_stage = str(item["current_stage"] or stage_flow.first_code(stages))
        else:
            previous = next((leg for leg in existing if leg["seq"] == pivot - 1), None)
            if previous is None:
                raise _conflict(f"There is no leg {pivot - 1} to continue from")
            nxt = stage_flow.next_code(stages, str(previous["stage_to"]))
            if nxt is None:
                raise _conflict("The route already reaches the final stage")
            start_stage = nxt

        start_at = req.start_at or datetime.now(route_plan.IST)
        try:
            planned = route_plan.plan_route(
                stages, leg_inputs, start_stage=start_stage, start_at=start_at
            )
        except RoutePlanError as exc:
            raise _unprocessable(str(exc)) from exc

        # ─── Write ────────────────────────────────────────────────────────────
        cancelled = await route_repo.cancel_open_legs(session, order_item_id, from_seq=pivot)
        inserted = []
        try:
            for offset, leg in enumerate(planned):
                inserted.append(await route_repo.insert_leg(
                    session,
                    order_item_id=order_item_id,
                    seq=pivot + offset,
                    workshop_id=leg.workshop_id,
                    stage_from=leg.stage_from,
                    stage_to=leg.stage_to,
                    planned_days=leg.planned_days,
                    due_at=leg.due_at,
                    actor_id=caller.salesperson_id,
                ))
        except IntegrityError as exc:
            # order_item_route_legs_seq_uidx: a concurrent plan took these sequence
            # numbers. Never an upsert — the caller is looking at stale state.
            logger.info("Concurrent route plan on item %s: %s", order_item_id, exc)
            raise _conflict("This item was re-planned concurrently — refresh and retry") from exc

        first = inserted[0]
        await route_repo.set_leg_status(session, first["id"], "active", stamp_activated=True)
        allocation = await production_repo.allocate(
            session,
            order_item_id=order_item_id,
            workshop_id=UUID(str(first["workshop_id"])),
            due_date=None,
            due_at=first["due_at"],
            route_leg_id=first["id"],
            start_stage=str(first["stage_from"]),
            actor_id=UUID(caller.salesperson_id),
        )
        await route_repo.record_route_audit(
            session, order_item_id=order_item_id, action="plan", actor_id=caller.salesperson_id,
            payload={
                "from_seq": pivot,
                "cancelled_legs": cancelled,
                "template_id": str(req.template_id) if req.template_id else None,
                "legs": [
                    {"seq": leg["seq"], "workshop_id": str(leg["workshop_id"]),
                     "stage_from": leg["stage_from"], "stage_to": leg["stage_to"],
                     "planned_days": leg["planned_days"],
                     "due_at": leg["due_at"].isoformat() if leg["due_at"] else None}
                    for leg in inserted
                ],
            },
        )
        await session.commit()

    logger.info("Routed item %s over %d leg(s) from seq %d", order_item_id, len(inserted), pivot)
    return {
        "order_item_id": str(order_item_id),
        "from_seq": pivot,
        "cancelled_legs": cancelled,
        "legs": inserted,
        "activated_leg_id": str(first["id"]),
        "assignment": {
            "assignment_id": allocation.assignment_id,
            "workshop_id": allocation.workshop_id,
            "current_stage": allocation.current_stage,
            "due_at": allocation.due_at.isoformat() if allocation.due_at else None,
            "due_date": allocation.due_date.isoformat() if allocation.due_date else None,
        },
    }


@router.post("/items/{order_item_id}/reflow")
async def reflow_route(order_item_id: UUID, req: ReflowRequest,
                       caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Recompute the deadlines of the not-yet-started legs, from now (or `from_at`).

    THE ONLY way a downstream deadline moves. A late leg does not silently slide the
    rest of the route (module 14 D11, client-confirmed 2026-07-27): a due date is a
    commitment derived from the customer's delivery date, and moving it quietly destroys
    the only signal that the order is running late. So this is an explicit owner/admin
    action, it demands a reason, and it writes an audit row.
    """
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        authz.assert_admin(caller, action="reflow a production route")

        legs = await route_repo.lock_legs_for_item(session, order_item_id)
        if not legs:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="This item has no route to reflow")

        open_legs = [leg for leg in legs if leg["status"] in route_repo.OPEN_LEG_STATUSES]
        if not open_legs:
            raise _conflict("Every leg on this route is finished or cancelled")

        # Default pivot: the first leg that has NOT started. An active leg's own
        # deadline is the one the workshop is already being judged against, so moving
        # it would erase the miss rather than record it.
        default_pivot = min(
            (leg["seq"] for leg in open_legs if leg["status"] in ("pending", "in_transit")),
            default=None,
        )
        pivot = req.from_seq or default_pivot
        if pivot is None:
            raise _conflict(
                "The only open leg is the one being worked on — its deadline is the "
                "commitment it is already measured against and cannot be reflowed"
            )

        planned = tuple(
            route_plan.PlannedLeg(
                seq=leg["seq"], workshop_id=str(leg["workshop_id"]),
                stage_from=str(leg["stage_from"]), stage_to=str(leg["stage_to"]),
                planned_days=leg["planned_days"], due_at=leg["due_at"],
            )
            for leg in legs if leg["status"] != "cancelled"
        )
        from_at = req.from_at or datetime.now(route_plan.IST)
        try:
            reflowed = route_plan.reflow(planned, from_at=from_at, reflow_from_seq=pivot)
        except RoutePlanError as exc:
            raise _unprocessable(str(exc)) from exc

        by_seq = {leg["seq"]: leg for leg in legs}
        changes = []
        for leg in reflowed:
            row = by_seq.get(leg.seq)
            if row is None or row["due_at"] == leg.due_at:
                continue
            await route_repo.set_leg_due_at(session, row["id"], leg.due_at)
            changes.append({
                "seq": leg.seq,
                "was": row["due_at"].isoformat() if row["due_at"] else None,
                "now": leg.due_at.isoformat() if leg.due_at else None,
            })

        await route_repo.record_route_audit(
            session, order_item_id=order_item_id, action="reflow",
            actor_id=caller.salesperson_id,
            payload={"reason": req.reason, "from_seq": pivot, "changes": changes},
        )
        await session.commit()

    logger.warning("Route reflowed on item %s from leg %s by %s (%s)",
                   order_item_id, pivot, caller.salesperson_id, req.reason)
    return {"order_item_id": str(order_item_id), "from_seq": pivot, "changes": changes}


# ─── Route templates ─────────────────────────────────────────────────────────
@router.get("/templates")
async def list_templates(active: bool = True, caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        await authz.resolve_caller(session, caller_uid)
        templates = await route_repo.list_templates(session, active_only=active)
    return {"templates": templates}


@router.post("/templates", status_code=status.HTTP_201_CREATED)
async def create_template(req: TemplateRequest,
                          caller_uid: str = Depends(get_caller_uid)) -> dict:
    """A template is validated the same way a real route is, minus the item-specific
    start stage: a template that cannot be applied to anything is a trap that only
    surfaces weeks later at the allocate screen."""
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        authz.assert_admin(caller, action="manage route templates")
        await _assert_workshops_active(session, [str(leg.workshop_id) for leg in req.legs])

        stages = stage_flow.to_stages(await production_repo.stage_defs(session))
        specs = [
            LegSpec(workshop_id=str(leg.workshop_id), stage_from=leg.stage_from,
                    stage_to=leg.stage_to, planned_days=leg.planned_days)
            for leg in req.legs
        ]
        try:
            route_plan.validate_cover(stages, specs, start_stage=req.legs[0].stage_from)
        except RoutePlanError as exc:
            raise _unprocessable(str(exc)) from exc

        try:
            template = await route_repo.create_template(
                session, name=req.name.strip(), notes=req.notes,
                actor_id=caller.salesperson_id,
            )
        except IntegrityError as exc:
            raise _conflict(f"A route template named '{req.name}' already exists") from exc

        await route_repo.replace_template_legs(
            session, UUID(str(template["id"])),
            [{"workshop_id": str(leg.workshop_id), "stage_from": leg.stage_from,
              "stage_to": leg.stage_to, "planned_days": leg.planned_days}
             for leg in req.legs],
        )
        await session.commit()
    return template


@router.post("/templates/{template_id}/deactivate")
async def deactivate_template(template_id: UUID,
                              caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        authz.assert_admin(caller, action="manage route templates")
        row = await route_repo.deactivate_template(session, template_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Route template not found")
        await session.commit()
    return row
