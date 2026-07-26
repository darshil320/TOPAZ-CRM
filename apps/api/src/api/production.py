"""Production API — allocation (module 08) + the stage machine (module 09/14).

    POST /api/production/allocate
      req  {order_item_id: uuid, workshop_id: uuid, due_date?: YYYY-MM-DD}
      200  {assignment_id, order_item_id, workshop_id, due_date,
            current_stage, previous_workshop_id}
      403  caller may not allocate this order's item
      404  unknown item / unknown workshop
      409  workshop inactive · order status not confirmed|in_production ·
           item already finished · concurrent allocation
      422  due_date in the past

    GET  /api/production/unallocated       confirmed/in-production items, no workshop yet
    GET  /api/production/my-queue          the workshop PWA's queue (money-blind)
    GET  /api/production/items/{id}        one item: state + route + event timeline

    POST /api/production/items/{id}/advance         {note?, media_id?, stage_code?}
    POST /api/production/items/{id}/block           {note}
    POST /api/production/items/{id}/unblock         {note?}
    POST /api/production/items/{id}/override-stage  {target_stage, reason}   owner/admin

THIS ROUTER IS THE ONLY WRITER of production state. Before module 09 the dashboard's
workshop server action inserted `production_events` AND re-wrote `current_stage` /
`current_stage_at` / `orders.status` from the browser session — duplicating
production_event_apply() (0024) and skipping every guard below. Routing adds three more
guards, so that duplicate had to go: apps/dashboard/src/app/workshop/actions.ts now
calls these endpoints (module 14 §1.1).

─── The advance guards, in the order they run ─────────────────────────────────
  1. the item is allocated                          409 (nothing to advance)
  2. the item is not already finished               409
  3. the item is NOT IN TRANSIT                     409  ← module 14 D9
  4. the item is not blocked                        409
  5. the caller has CAP_STATUS at the item's CURRENT workshop        403
  6. the stage is inside the ACTIVE LEG's span      409  ← module 14, stops workshop A
                                                          ticking workshop B's stages
  7. photo_required stages carry a media_id         409
  8. the stage is not already done                  409 (the DB index is the backstop)

Concurrency: lock_item_for_event() (SELECT ... FOR UPDATE) serialises the retried POST
of a flaky phone network; production_events_one_done_per_stage is the DB backstop and
surfaces as 409.
"""

import logging
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from ..database import make_task_session
from ..repositories import production_repo as repo
from ..repositories import route_repo, transfer_repo, workshop_staff_repo
from ..services import handover, stage_flow
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/production", dependencies=[Depends(require_dashboard_key)])

# Re-allocation mid-production is legitimate (a workshop falls behind); a cancelled,
# delivered or closed order is not.
_ALLOCATABLE_ORDER_STATUSES = {"confirmed", "in_production"}


class AllocateRequest(BaseModel):
    order_item_id: UUID
    workshop_id: UUID
    due_date: date | None = None


async def _active_workshop(session, workshop_id: UUID) -> None:
    row = await session.execute(
        text("SELECT active FROM workshops WHERE id = :id"), {"id": str(workshop_id)}
    )
    found = row.first()
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workshop not found")
    if not found[0]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Workshop is inactive")


@router.get("/unallocated")
async def unallocated(caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        if caller.role not in ("owner", "admin", "salesperson"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Your role cannot allocate production work")
        # Scope the queue the same way the write path is scoped: a salesperson may
        # only allocate their assigned customers' items, so listing everyone else's
        # customer names and order contents would leak without enabling any action.
        items = await repo.unallocated_items(
            session, salesperson_id=None if caller.is_admin else caller.salesperson_id
        )
    return {"items": items}


@router.post("/allocate")
async def allocate(req: AllocateRequest, caller_uid: str = Depends(get_caller_uid)) -> dict:
    if req.due_date is not None and req.due_date < date.today():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Due date is in the past")

    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        # A workshop manager must never self-allocate work; accounts/delivery have
        # no production role at all.
        if caller.role not in ("owner", "admin", "salesperson"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Your role cannot allocate production work")

        await _active_workshop(session, req.workshop_id)

        item = await repo.lock_item(session, req.order_item_id)
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order item not found")
        await authz.assert_can_write_customer(session, caller, str(item["customer_id"]))

        if item["order_status"] not in _ALLOCATABLE_ORDER_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot allocate an order with status '{item['order_status']}'",
            )
        if item["production_done_at"] is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="This item has already finished production")

        try:
            result = await repo.allocate(
                session, order_item_id=req.order_item_id, workshop_id=req.workshop_id,
                due_date=req.due_date, actor_id=UUID(caller.salesperson_id),
            )
        except IntegrityError as exc:
            # order_item_assignments_one_active fired: someone allocated the same
            # item between our lock and this insert (only reachable if the lock was
            # bypassed). Never an upsert — the caller must see stale state and refetch.
            logger.info("Concurrent allocation on item %s: %s", req.order_item_id, exc)
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Item was allocated concurrently — refresh and retry") from exc
        await session.commit()

    logger.info("Allocated item %s to workshop %s (was %s)",
                req.order_item_id, req.workshop_id, result.previous_workshop_id)
    return {
        "assignment_id": result.assignment_id,
        "order_item_id": result.order_item_id,
        "workshop_id": result.workshop_id,
        "due_date": result.due_date.isoformat() if result.due_date else None,
        "current_stage": result.current_stage,
        "previous_workshop_id": result.previous_workshop_id,
    }


# ════════════════════════════════════════════════════════════════════════════
# Module 09/14 — the stage machine
# ════════════════════════════════════════════════════════════════════════════
class AdvanceRequest(BaseModel):
    note: str | None = None
    media_id: UUID | None = None
    # Optional and CHECKED, not trusted: the phone sends what it thinks the current
    # stage is, and a mismatch means the screen is stale. Refusing beats silently
    # ticking a stage the manager was not looking at.
    stage_code: str | None = None


class BlockRequest(BaseModel):
    note: str = Field(min_length=1, max_length=500)


class UnblockRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class OverrideRequest(BaseModel):
    target_stage: str = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=500)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


async def _load_item_or_404(session, order_item_id: UUID) -> dict:
    item = await repo.lock_item_for_event(session, order_item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order item not found")
    return item


def _assert_workable(item: dict) -> None:
    """Guards 1–4: is this item in a state where a stage tap means anything?"""
    if item["current_stage"] is None or item["workshop_id"] is None:
        raise _conflict("This item is not allocated to a workshop yet")
    if item["production_done_at"] is not None:
        raise _conflict("This item has already finished production")
    if item["transit_transfer_id"] is not None:
        raise _conflict(
            "This item is in transit between workshops — receive it first, "
            "then update its stage"
        )


async def _assert_status_capability(session, caller, item: dict) -> frozenset[str]:
    caps = await authz.capabilities_at_workshop(session, caller, str(item["workshop_id"]))
    authz.assert_capability(caps, stage_flow.CAP_STATUS, action="update production status")
    return caps


@router.get("/my-queue")
async def my_queue(caller_uid: str = Depends(get_caller_uid)) -> dict:
    """The workshop PWA's My Queue — money-blind.

    Scoped by WORKSHOP STAFF (0029), not by the old single `manager_salesperson_id`:
    a sub-manager sees the same queue as their lead, which is the whole point of the
    hierarchy. Owner/admin see every active workshop, which is also what keeps a vendor
    workshop with no login at all visible to somebody (STATE.md discovery for 09).
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        if caller.is_admin:
            rows = await session.execute(
                text("SELECT id, name, type, address, 'lead' AS staff_role"
                     " FROM workshops WHERE active = true ORDER BY lower(name)")
            )
            workshops = [dict(m) for m in rows.mappings().all()]
        else:
            workshops = await workshop_staff_repo.my_workshops(session, caller.salesperson_id)

        workshop_ids = [str(w["id"]) for w in workshops]
        items = await repo.queue_for_workshop(session, workshop_ids)
        stages = await repo.stage_defs(session)
        incoming = []
        for ws in workshops:
            incoming.extend(await transfer_repo.list_transfers(
                session, workshop_id=str(ws["id"]), direction="in"
            ))
    return {
        "workshops": workshops,
        "items": items,
        "stages": stages,
        "incoming_transfers": incoming,
    }


@router.get("/items/{order_item_id}")
async def item_detail(order_item_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """One item's production state, route and event timeline — money-blind.

    Readable by owner/admin, any staff member of the workshop that currently holds it,
    or the assigned salesperson. A courier is NOT given a path here: they read items
    through their consignment (GET /api/transfers/{id}), which is scoped to the goods
    actually in their van.
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        state = await repo.item_production_state(session, order_item_id)
        if state is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Order item not found")
        caps = await authz.capabilities_at_workshop(
            session, caller, str(state["workshop_id"]) if state["workshop_id"] else None
        )
        if not caps:
            # Not workshop staff here and not admin — fall back to the sales boundary.
            order = await session.execute(
                text("SELECT customer_id FROM orders WHERE id = :id"),
                {"id": str(state["order_id"])},
            )
            row = order.mappings().first()
            await authz.assert_can_write_customer(
                session, caller, str(row["customer_id"]) if row else ""
            )
        legs = await route_repo.legs_for_item(session, order_item_id)
        events = await repo.item_events(session, order_item_id)
        stages = await repo.stage_defs(session)
        done = await repo.stage_done_codes(session, order_item_id)
    return {
        "item": state, "legs": legs, "events": events, "stages": stages,
        "done_stages": sorted(done),
        "capabilities": sorted(caps),
    }


@router.post("/items/{order_item_id}/advance")
async def advance(order_item_id: UUID, req: AdvanceRequest,
                  caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Mark the item's current stage done.

    On success the 0024 trigger moves `current_stage` to the next stage by `sort` and
    flips the order's status when appropriate — this route never writes those columns.

    If the completed stage is the ACTIVE LEG's `stage_to` and another leg follows, a
    consignment to the next workshop is opened in the same transaction (module 14 D6,
    client-confirmed: auto on stage done, with a lead-only manual override).
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        item = await _load_item_or_404(session, order_item_id)
        _assert_workable(item)
        if item["blocked"]:
            raise _conflict("This item is blocked — clear the blocker before advancing")
        await _assert_status_capability(session, caller, item)

        stages = stage_flow.to_stages(await repo.stage_defs(session))
        current = str(item["current_stage"])
        if req.stage_code is not None and req.stage_code != current:
            raise _conflict(
                f"This item is at '{current}', not '{req.stage_code}' — "
                "refresh and try again"
            )

        leg_id = item.get("leg_id")
        if leg_id is not None:
            if not stage_flow.is_within_span(
                stages, current, str(item["leg_stage_from"]), str(item["leg_stage_to"])
            ):
                raise _conflict(
                    f"Stage '{current}' belongs to another workshop on this item's route"
                )
            if str(item["leg_workshop_id"]) != str(item["workshop_id"]):
                # The leg and the custody record disagree: only reachable if somebody
                # wrote order_item_assignments outside the API. Refuse rather than pick.
                raise _conflict(
                    "This item's route and its current workshop disagree — ask the owner "
                    "to re-plan the route"
                )

        if stage_flow.photo_required_for(stages, current) and req.media_id is None:
            raise _conflict(f"Stage '{current}' requires a photo before it can be completed")

        if current in await repo.stage_done_codes(session, order_item_id):
            raise _conflict(f"Stage '{current}' is already marked done on this item")

        try:
            event_id = await repo.insert_event(
                session, order_item_id=order_item_id, stage_code=current, kind="done",
                note=req.note, media_id=req.media_id, actor_id=caller.salesperson_id,
            )
        except IntegrityError as exc:
            logger.info("Concurrent advance on item %s stage %s: %s", order_item_id, current, exc)
            raise _conflict("This stage was completed concurrently — refresh and retry") from exc

        next_stage = stage_flow.next_code(stages, current)
        opened_transfer: dict | None = None

        if leg_id is not None and current == str(item["leg_stage_to"]) and next_stage is not None:
            next_leg = await route_repo.leg_by_seq(
                session, order_item_id, int(item["leg_seq"]) + 1
            )
            if next_leg is not None:
                try:
                    opened_transfer = await handover.open_handover(
                        session,
                        order_item_id=order_item_id,
                        from_workshop_id=str(item["workshop_id"]),
                        to_workshop_id=str(next_leg["workshop_id"]),
                        completed_leg_id=str(leg_id),
                        destination_leg_id=str(next_leg["id"]),
                        due_at=next_leg["due_at"],
                        actor_id=caller.salesperson_id,
                        qty=float(item["qty"]) if item["qty"] is not None else None,
                    )
                except IntegrityError as exc:
                    logger.info("Item %s already on an open consignment: %s", order_item_id, exc)
                    raise _conflict(
                        "This item is already on an open consignment — refresh and retry"
                    ) from exc
            else:
                # Last leg finished. Close it; nothing moves.
                await route_repo.set_leg_status(session, leg_id, "completed",
                                                stamp_completed=True)
        elif leg_id is not None and current == str(item["leg_stage_to"]):
            await route_repo.set_leg_status(session, leg_id, "completed", stamp_completed=True)

        await session.commit()

    _notify("stage_done", event_id=event_id, order_item_id=str(order_item_id),
            transfer_id=opened_transfer["id"] if opened_transfer else None)

    return {
        "event_id": event_id,
        "order_item_id": str(order_item_id),
        "completed_stage": current,
        "next_stage": next_stage,
        "done": next_stage is None,
        "transfer": _transfer_summary(opened_transfer),
    }


@router.post("/items/{order_item_id}/block")
async def block(order_item_id: UUID, req: BlockRequest,
                caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Flag the item as stuck, with a reason.

    Allowed WHILE IN TRANSIT, unlike advance: transit damage is discovered exactly
    when the goods are on the lorry, and refusing the block would leave the only person
    who can see the problem with no way to report it (module 14 D9).
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        item = await _load_item_or_404(session, order_item_id)
        if item["current_stage"] is None:
            raise _conflict("This item is not allocated to a workshop yet")
        if item["production_done_at"] is not None:
            raise _conflict("This item has already finished production")
        await _assert_status_capability(session, caller, item)
        if item["blocked"]:
            raise _conflict("This item is already blocked")

        event_id = await repo.insert_event(
            session, order_item_id=order_item_id, stage_code=str(item["current_stage"]),
            kind="blocked", note=req.note, actor_id=caller.salesperson_id,
        )
        await session.commit()
    _notify("blocked", event_id=event_id, order_item_id=str(order_item_id))
    return {"event_id": event_id, "order_item_id": str(order_item_id), "blocked": True}


@router.post("/items/{order_item_id}/unblock")
async def unblock(order_item_id: UUID, req: UnblockRequest,
                  caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        item = await _load_item_or_404(session, order_item_id)
        if item["current_stage"] is None:
            raise _conflict("This item is not allocated to a workshop yet")
        await _assert_status_capability(session, caller, item)
        if not item["blocked"]:
            raise _conflict("This item is not blocked")

        event_id = await repo.insert_event(
            session, order_item_id=order_item_id, stage_code=str(item["current_stage"]),
            kind="unblocked", note=req.note, actor_id=caller.salesperson_id,
        )
        await session.commit()
    _notify("unblocked", event_id=event_id, order_item_id=str(order_item_id))
    return {"event_id": event_id, "order_item_id": str(order_item_id), "blocked": False}


@router.post("/items/{order_item_id}/override-stage")
async def override_stage(order_item_id: UUID, req: OverrideRequest,
                         caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Owner/admin escape hatch: jump an item forward to `target_stage`.

    Inserts a `done` event for every stage it skips, IN ASCENDING SORT ORDER. The order
    is load-bearing: production_event_apply()'s monotonic guard silently drops any event
    that would move `current_stage` backwards, so a descending insert would leave the
    item parked at the first stage written (STATE.md discovery for module 09).

    Every skipped event carries the reason, so the item's timeline says out loud that a
    human overrode it rather than showing eleven suspiciously fast stage taps.
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        authz.assert_admin(caller, action="override a production stage")
        item = await _load_item_or_404(session, order_item_id)
        _assert_workable(item)

        stages = stage_flow.to_stages(await repo.stage_defs(session))
        current = str(item["current_stage"])
        if stage_flow.sort_of(stages, req.target_stage) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"Unknown stage '{req.target_stage}'")
        skipped = stage_flow.skipped_codes(stages, current, req.target_stage)
        if not skipped:
            raise _conflict(
                f"'{req.target_stage}' is not ahead of '{current}' — "
                "an override can only move an item forward"
            )

        already_done = await repo.stage_done_codes(session, order_item_id)
        note = f"admin override: {req.reason}"
        written: list[str] = []
        for code in skipped:
            if code in already_done:
                continue
            await repo.insert_event(
                session, order_item_id=order_item_id, stage_code=code, kind="done",
                note=note, actor_id=caller.salesperson_id,
            )
            written.append(code)

        await repo.record_override_audit(
            session, order_item_id=order_item_id, actor_id=caller.salesperson_id,
            from_stage=current, to_stage=req.target_stage, reason=req.reason,
            skipped=written,
        )
        await session.commit()

    logger.warning("Stage override on item %s: %s → %s by %s (%s)",
                   order_item_id, current, req.target_stage, caller.salesperson_id, req.reason)
    return {
        "order_item_id": str(order_item_id),
        "from_stage": current,
        "to_stage": req.target_stage,
        "skipped_stages": written,
    }


def _transfer_summary(transfer: dict | None) -> dict | None:
    """The subset of a consignment the PWA needs to render "handed over to X"."""
    if transfer is None:
        return None
    return {
        "id": str(transfer["id"]),
        "transfer_no": transfer["transfer_no"],
        "to_workshop_id": str(transfer["to_workshop_id"]),
        "status": transfer["status"],
        "due_at": transfer["due_at"].isoformat() if transfer.get("due_at") else None,
    }


def _notify(kind: str, **payload) -> None:
    """Fire-and-forget notification enqueue.

    Wrapped and swallowed on purpose: a broker hiccup must not roll back a stage the
    manager has already been told succeeded, and it must not 500 either. Same call the
    payments router makes for receipt rendering (STATE.md 07, "payment enqueue failure
    no longer 500s"). The failure is logged at WARNING so it is visible in Railway.
    """
    try:
        from ..tasks.production_notify import notify_production_event

        notify_production_event.delay(kind, payload)
    except Exception as exc:  # noqa: BLE001 — broker/import failure must not surface
        logger.warning("Could not enqueue %s notification (%s): %s", kind, payload, exc)
