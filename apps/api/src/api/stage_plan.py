"""Stage-plan API — per-stage day budgets, skip, and snooze (0035).

    GET   /api/stage-plan/items/{item_id}
            200 {plan:[...], stages:[...], budget_days, used_days, remaining_days,
                 due_date, leg_dues}
            403 caller may not see this item's production
            404 unknown item

    PUT   /api/stage-plan/items/{item_id}                       owner/admin/sales
            req {rows:[{stage_code, planned_days?, skipped?, remind?}]}
            200 {plan, used_days, budget_days, remaining_days, scaled}
            422 the plan does not fit (every problem listed, not just the first)

    POST  /api/stage-plan/items/{item_id}/stages/{stage_code}/snooze
            req {hours?}   → pushes the reminder out and un-claims it
            404 no plan row for that stage

    PATCH /api/stage-plan/stage-defs/{stage_code}               owner/admin
            req {default_days?}  → the admin-level default new plans seed from

WHY THIS ROUTER OWNS THE WRITE: the plan's invariant — the non-skipped stages' days may
not add up past the item's due date — spans every row, and 0035 therefore grants the
browser no write at all. The PUT is a REPLACE-ALL inside one transaction, so the sum
holds at every commit and the plan is never half-written.

CAPABILITY: planning is `allocate` (services/stage_flow), the same capability that
governs allocation and routing — a stage budget is a planning act, not a shop-floor one.
Snooze is deliberately different: it is `status`, because the person who needs four more
hours is the manager doing the work.
"""

import logging
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..database import make_task_session
from ..repositories import stage_plan_repo
from ..services import stage_flow, stage_plan
from ..services.stage_plan import PlanRow
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stage-plan", dependencies=[Depends(require_dashboard_key)])

# Snooze ceiling. A day is the most a shop-floor "not now" should be able to silence a
# deadline for — beyond that the owner should be editing the plan, not muting it.
_MAX_SNOOZE_HOURS = 24
_DEFAULT_SNOOZE_HOURS = 4


class PlanRowInput(BaseModel):
    stage_code: str = Field(min_length=1)
    # `le=365`: a single stage taking over a year is a typo, and the DB check only
    # catches the zero/negative end.
    planned_days: int | None = Field(default=None, ge=1, le=365)
    skipped: bool = False
    remind: bool = True


class PutPlanRequest(BaseModel):
    rows: list[PlanRowInput] = Field(min_length=1)


class SnoozeRequest(BaseModel):
    hours: int = Field(default=_DEFAULT_SNOOZE_HOURS, ge=1, le=_MAX_SNOOZE_HOURS)


class StageDefaultRequest(BaseModel):
    default_days: int | None = Field(default=None, ge=1, le=365)


async def _load_context(session, order_item_id: UUID) -> dict:
    context = await stage_plan_repo.plan_context(session, order_item_id)
    if context is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order item not found")
    return context


async def _assert_can_read(session, caller: authz.Caller, context: dict) -> frozenset[str]:
    """Same boundary as GET /api/production/items/{id}: workshop staff of the site
    holding it, or the salesperson who owns the customer, or owner/admin."""
    caps = await authz.capabilities_at_workshop(
        session, caller, str(context["workshop_id"]) if context["workshop_id"] else None
    )
    if not caps:
        await authz.assert_can_write_customer(session, caller, str(context["customer_id"]))
    return caps


def _start_date() -> date:
    """Where the schedule starts counting from: TODAY, not the allocation date.

    A plan edited on day 6 of a 10-day budget has 4 days left, not 10 — measuring from
    the allocation date would keep validating a schedule that has already run out of room.
    """
    return date.today()


def _plan_summary(rows: list[PlanRow], *, start: date, due_date: date | None) -> dict:
    budget = stage_plan.budget_days(start_date=start, due_date=due_date)
    used = stage_plan.total_days(rows)
    return {
        "budget_days": budget,
        "used_days": used,
        "remaining_days": None if budget is None else budget - used,
        "due_date": due_date.isoformat() if due_date else None,
    }


def _to_plan_rows(rows: list[PlanRowInput]) -> list[PlanRow]:
    return [
        PlanRow(
            stage_code=r.stage_code,
            # A skipped stage carries no days, whatever the form left in the field —
            # otherwise a stale input value trips stage_plan_skip_consistency (0035) as
            # a 500 instead of being the no-op the operator meant.
            planned_days=None if r.skipped else r.planned_days,
            skipped=r.skipped,
            remind=r.remind,
        )
        for r in rows
    ]


@router.get("/items/{order_item_id}")
async def get_plan(order_item_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        context = await _load_context(session, order_item_id)
        await _assert_can_read(session, caller, context)

        plan = await stage_plan_repo.get_plan(session, order_item_id)
        stages = await stage_plan_repo.stage_defs_with_defaults(session)
        leg_dues = await stage_plan_repo.leg_dues_by_stage(session, order_item_id)

    rows = [
        PlanRow(
            stage_code=str(p["stage_code"]),
            planned_days=p["planned_days"],
            skipped=bool(p["skipped"]),
            remind=bool(p["remind"]),
        )
        for p in plan
    ]
    return {
        "order_item_id": str(order_item_id),
        "plan": plan,
        "stages": stages,
        "leg_dues": {code: due.isoformat() for code, due in leg_dues.items()},
        **_plan_summary(rows, start=_start_date(), due_date=context["due_date"]),
    }


@router.put("/items/{order_item_id}")
async def put_plan(order_item_id: UUID, req: PutPlanRequest,
                   caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Replace this item's whole stage schedule, atomically."""
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        context = await _load_context(session, order_item_id)
        caps = await authz.capabilities_at_workshop(
            session, caller, str(context["workshop_id"]) if context["workshop_id"] else None
        )
        authz.assert_capability(caps, stage_flow.CAP_ALLOCATE, action="plan stage schedules")
        if not caller.is_admin:
            # A salesperson holds `allocate` everywhere, so the customer boundary is what
            # actually scopes them — exactly as in POST /api/production/allocate.
            await authz.assert_can_write_customer(session, caller, str(context["customer_id"]))
        if context["production_done_at"] is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This item has finished production — its schedule is history",
            )

        stages = await stage_plan_repo.stage_defs_with_defaults(session)
        stage_order = [str(s["code"]) for s in stages]
        leg_dues = await stage_plan_repo.leg_dues_by_stage(session, order_item_id)

        rows = _to_plan_rows(req.rows)
        start = _start_date()
        start_at = datetime.now(timezone.utc)
        errors = stage_plan.validate_plan(
            rows, stage_order=stage_order, start_date=start,
            due_date=context["due_date"], leg_dues=leg_dues, start_at=start_at,
        )
        if errors:
            # The FIRST error is the 422 detail (FastAPI's shape), every error is in the
            # body so the UI can render them all under the fields that caused them.
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"message": errors[0], "errors": errors},
            )

        resolved = stage_plan.cumulative_dues(rows, start_at=start_at, stage_order=stage_order)
        await stage_plan_repo.replace_plan(
            session, order_item_id,
            [
                {
                    "stage_code": s.stage_code, "planned_days": s.planned_days,
                    "skipped": s.skipped, "remind": s.remind, "due_at": s.due_at,
                }
                for s in resolved
            ],
            created_by=caller.salesperson_id,
        )
        await session.commit()
        plan = await stage_plan_repo.get_plan(session, order_item_id)

    logger.info("Stage plan replaced for item %s by %s (%d stages, %d days)",
                order_item_id, caller.salesperson_id, len(resolved),
                stage_plan.total_days(rows))
    return {
        "order_item_id": str(order_item_id),
        "plan": plan,
        **_plan_summary(rows, start=start, due_date=context["due_date"]),
    }


@router.post("/items/{order_item_id}/stages/{stage_code}/snooze")
async def snooze_stage(order_item_id: UUID, stage_code: str, req: SnoozeRequest,
                       caller_uid: str = Depends(get_caller_uid)) -> dict:
    """"Not now" from the shop floor: push the reminder out and let it fire again later.

    Gated on `status`, not `allocate`: the person who needs four more hours is the manager
    holding the goods, and making them ask the owner to silence a nag would guarantee the
    nag is ignored instead.
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        context = await _load_context(session, order_item_id)
        caps = await authz.capabilities_at_workshop(
            session, caller, str(context["workshop_id"]) if context["workshop_id"] else None
        )
        authz.assert_capability(caps, stage_flow.CAP_STATUS, action="snooze a stage reminder")

        row = await stage_plan_repo.snooze(session, order_item_id, stage_code, hours=req.hours)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No planned stage '{stage_code}' on this item",
            )
        await session.commit()

    logger.info("Stage %s on item %s snoozed %dh by %s",
                stage_code, order_item_id, req.hours, caller.salesperson_id)
    return {"order_item_id": str(order_item_id), "stage": row}


@router.get("/stage-defs")
async def list_stage_defaults(caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with make_task_session() as session:
        await authz.resolve_caller(session, caller_uid)
        stages = await stage_plan_repo.stage_defs_with_defaults(session)
    return {"stages": stages}


@router.patch("/stage-defs/{stage_code}")
async def set_stage_default(stage_code: str, req: StageDefaultRequest,
                            caller_uid: str = Depends(get_caller_uid)) -> dict:
    """The admin-level default a freshly-allocated item's plan seeds from.

    `default_days = null` means "not costed": seed_from_defaults() marks such a stage
    SKIPPED rather than inventing a duration for it.
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        authz.assert_admin(caller, action="change a stage's default duration")
        row = await stage_plan_repo.set_default_days(session, stage_code, req.default_days)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"Unknown stage '{stage_code}'")
        await session.commit()
    logger.info("Stage %s default_days set to %s by %s",
                stage_code, req.default_days, caller.salesperson_id)
    return {"stage": row}


async def seed_plan_for_item(
    session,
    order_item_id: UUID,
    *,
    due_date: date | None,
    actor_id: str | None,
) -> dict | None:
    """Seed a plan from the admin defaults, at allocation time. BEST EFFORT.

    Called from POST /api/production/allocate inside its transaction. It must never fail
    the allocation: a reminder schedule is a convenience, and refusing to allocate work
    because the owner has not costed the stages would be absurd. Returns a summary for
    the log, or None when there was nothing to seed.

    An existing plan is left alone — re-allocating an item mid-production (a workshop
    falls behind) must not silently discard the schedule the owner hand-edited.
    """
    if await stage_plan_repo.plan_exists(session, order_item_id):
        return None
    stages = await stage_plan_repo.stage_defs_with_defaults(session)
    rows = stage_plan.seed_from_defaults(stages)
    if not stage_plan.active_rows(rows):
        return None            # no stage has been costed yet — nothing to schedule

    start = date.today()
    budget = stage_plan.budget_days(start_date=start, due_date=due_date)
    rows, scaled = stage_plan.scale_to_budget(rows, budget=budget)
    stage_order = [str(s["code"]) for s in stages]
    start_at = datetime.now(timezone.utc)
    errors = stage_plan.validate_plan(
        rows, stage_order=stage_order, start_date=start, due_date=due_date
    )
    if errors:
        # The defaults genuinely do not fit this deadline even squeezed. Seeding an
        # already-overdue plan would put every stage instantly red, so seed nothing and
        # let the operator plan it by hand.
        logger.info("Not seeding a stage plan for item %s: %s", order_item_id, errors[0])
        return None

    resolved = stage_plan.cumulative_dues(rows, start_at=start_at, stage_order=stage_order)
    await stage_plan_repo.replace_plan(
        session, order_item_id,
        [
            {
                "stage_code": s.stage_code, "planned_days": s.planned_days,
                "skipped": s.skipped, "remind": s.remind, "due_at": s.due_at,
            }
            for s in resolved
        ],
        created_by=actor_id,
    )
    return {"stages": len(resolved), "used_days": stage_plan.total_days(rows), "scaled": scaled}
