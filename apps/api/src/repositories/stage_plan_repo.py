"""Stage-plan repository — per-item day budgets and their reminder state (0035).

Service-role writes only: 0035 grants `authenticated` SELECT and nothing else, because
the plan's defining invariant (the days must not add up past the item's due date) spans
every row of the plan and a browser inserting one row could not be checked against it.
api/stage_plan.py is the authz boundary; this module is only SQL.

Two write shapes, both deliberate:

  * `replace_plan` — DELETE then INSERT inside the caller's transaction. The plan is
    never half-written, so the sum invariant holds at every commit.
  * `claim_reminder` — `UPDATE … WHERE reminded_at IS NULL RETURNING id`. That is the
    single-fire guarantee for the WhatsApp reminder: a Celery retry after a partial
    failure claims nothing and sends nothing.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_FIELDS = (
    "id", "order_item_id", "stage_code", "planned_days", "skipped", "remind",
    "due_at", "reminded_at", "snoozed_until", "created_by", "created_at", "updated_at",
)


async def get_plan(session: AsyncSession, order_item_id: UUID) -> list[dict]:
    """One item's plan in STAGE order, each row carrying its stage labels.

    Ordered by `production_stage_defs.sort` rather than by insertion: the plan is read
    as a schedule, and a schedule out of order is not a schedule.
    """
    result = await session.execute(
        text(
            f"SELECT {', '.join('p.' + f for f in _FIELDS)},"
            "       sd.label_en, sd.label_gu, sd.sort, sd.photo_required"
            " FROM order_item_stage_plan p"
            " JOIN production_stage_defs sd ON sd.code = p.stage_code"
            " WHERE p.order_item_id = :id"
            " ORDER BY sd.sort"
        ),
        {"id": str(order_item_id)},
    )
    return [dict(m) for m in result.mappings().all()]


async def replace_plan(
    session: AsyncSession,
    order_item_id: UUID,
    rows: list[dict],
    *,
    created_by: str | UUID | None,
) -> None:
    """Wholesale replace, in the CALLER's transaction (no commit here).

    Replace rather than upsert-and-diff: the operator's Save is a statement about the
    whole schedule, and a diff would have to decide what an omitted stage means. Deleting
    a plan row destroys only a reminder — the production record lives in
    `production_events`, which is append-only and untouched by this.
    """
    await session.execute(
        text("DELETE FROM order_item_stage_plan WHERE order_item_id = :id"),
        {"id": str(order_item_id)},
    )
    for row in rows:
        await session.execute(
            text(
                "INSERT INTO order_item_stage_plan"
                " (order_item_id, stage_code, planned_days, skipped, remind, due_at,"
                "  created_by)"
                " VALUES (:item, :stage, :days, :skipped, :remind, :due_at, :by)"
            ),
            {
                "item": str(order_item_id),
                "stage": row["stage_code"],
                "days": row.get("planned_days"),
                "skipped": bool(row.get("skipped", False)),
                "remind": bool(row.get("remind", True)),
                "due_at": row.get("due_at"),
                "by": str(created_by) if created_by else None,
            },
        )


async def plan_exists(session: AsyncSession, order_item_id: UUID) -> bool:
    result = await session.execute(
        text("SELECT 1 FROM order_item_stage_plan WHERE order_item_id = :id LIMIT 1"),
        {"id": str(order_item_id)},
    )
    return result.first() is not None


async def plan_context(session: AsyncSession, order_item_id: UUID) -> dict | None:
    """Everything validate_plan() needs about the item: its deadline and its workshop.

    `due_date` comes from the ACTIVE assignment — the retired ones are history — and is
    the ceiling every stage plan is measured against.
    """
    result = await session.execute(
        text(
            "SELECT oi.id, oi.order_id, oi.description, oi.current_stage,"
            "       oi.workshop_id, oi.production_done_at, oi.blocked,"
            "       o.customer_id, o.order_no,"
            "       a.due_date, a.due_at, a.created_at AS allocated_at"
            " FROM order_items oi"
            " JOIN orders o ON o.id = oi.order_id"
            " LEFT JOIN order_item_assignments a"
            "        ON a.order_item_id = oi.id AND a.active = true"
            " WHERE oi.id = :id"
        ),
        {"id": str(order_item_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def leg_dues_by_stage(session: AsyncSession, order_item_id: UUID) -> dict[str, datetime]:
    """`{stage_code: the due instant of the leg that owns it}`.

    Legs stay AUTHORITATIVE for handover (0030), so this is what the stage plan is
    checked against. Cancelled legs are excluded — a cancelled leg owns nothing. The span
    is expanded here rather than in SQL-over-sort arithmetic so one function
    (services/stage_flow.codes_in_span) remains the only authority on stage ranges.
    """
    from ..services import stage_flow
    from . import production_repo

    result = await session.execute(
        text(
            "SELECT stage_from, stage_to, due_at FROM order_item_route_legs"
            " WHERE order_item_id = :id AND status <> 'cancelled' AND due_at IS NOT NULL"
            " ORDER BY seq"
        ),
        {"id": str(order_item_id)},
    )
    legs = result.mappings().all()
    if not legs:
        return {}
    stages = stage_flow.to_stages(await production_repo.stage_defs(session))
    dues: dict[str, datetime] = {}
    for leg in legs:
        for code in stage_flow.codes_in_span(stages, str(leg["stage_from"]), str(leg["stage_to"])):
            dues[code] = leg["due_at"]
    return dues


async def stage_defs_with_defaults(session: AsyncSession) -> list[dict]:
    """Active stages plus their admin-level `default_days` — the seeding input."""
    result = await session.execute(
        text(
            "SELECT code, sort, label_en, label_gu, photo_required, default_days"
            " FROM production_stage_defs WHERE active = true ORDER BY sort"
        )
    )
    return [dict(m) for m in result.mappings().all()]


async def set_default_days(
    session: AsyncSession, stage_code: str, default_days: int | None
) -> dict | None:
    result = await session.execute(
        text(
            "UPDATE production_stage_defs SET default_days = :days WHERE code = :code"
            " RETURNING code, sort, label_en, label_gu, photo_required, default_days"
        ),
        {"code": stage_code, "days": default_days},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


# ─── Reminder engine ─────────────────────────────────────────────────────────
async def due_reminders(session: AsyncSession, *, limit: int = 100) -> list[dict]:
    """Stage deadlines that have passed and have not been reminded about yet.

    Every predicate is covered by order_item_stage_plan_due_idx (0035), so the hourly
    beat is an index probe.

    Excluded, and why:
      * `skipped` / `remind = false`     — the operator said no.
      * `reminded_at IS NOT NULL`        — already sent (claim_reminder is the backstop).
      * `snoozed_until > now()`          — the manager asked for four more hours.
      * `production_done_at IS NOT NULL` — the item is finished; the schedule is moot.
      * a stage already marked done       — the work happened, deadline or not. THIS is
        the check that stops the beat nagging about a stage the workshop cleared early.

    Blocked items are INCLUDED: a blocked item is exactly the one whose slipping deadline
    the owner needs to hear about (same call as route_repo.overdue_active_legs).
    """
    result = await session.execute(
        text(
            "SELECT p.id, p.order_item_id, p.stage_code, p.due_at, p.planned_days,"
            "       sd.label_en AS stage_label_en, sd.label_gu AS stage_label_gu,"
            "       oi.description, oi.current_stage, oi.blocked, oi.workshop_id,"
            "       o.id AS order_id, o.order_no, o.customer_id,"
            "       c.name AS customer_name,"
            "       w.name AS workshop_name"
            " FROM order_item_stage_plan p"
            " JOIN production_stage_defs sd ON sd.code = p.stage_code"
            " JOIN order_items oi ON oi.id = p.order_item_id"
            " JOIN orders o ON o.id = oi.order_id"
            " JOIN customers c ON c.id = o.customer_id"
            " LEFT JOIN workshops w ON w.id = oi.workshop_id"
            " WHERE p.skipped = false AND p.remind = true"
            "   AND p.reminded_at IS NULL AND p.due_at IS NOT NULL AND p.due_at <= now()"
            "   AND (p.snoozed_until IS NULL OR p.snoozed_until <= now())"
            "   AND oi.production_done_at IS NULL"
            "   AND NOT EXISTS (SELECT 1 FROM production_events e"
            "                    WHERE e.order_item_id = p.order_item_id"
            "                      AND e.stage_code = p.stage_code AND e.kind = 'done')"
            " ORDER BY p.due_at LIMIT :limit"
        ),
        {"limit": limit},
    )
    return [dict(m) for m in result.mappings().all()]


async def claim_reminder(session: AsyncSession, plan_id: UUID | str) -> bool:
    """Stamp `reminded_at` and report whether WE were the ones who stamped it.

    THE single-fire guarantee. Called BEFORE the WhatsApp send: if the send then fails,
    the row stays claimed and the owner gets one missing reminder — strictly better than a
    Celery retry re-sending the same nag to a shop floor every hour.
    """
    result = await session.execute(
        text(
            "UPDATE order_item_stage_plan SET reminded_at = now()"
            " WHERE id = :id AND reminded_at IS NULL RETURNING id"
        ),
        {"id": str(plan_id)},
    )
    return result.first() is not None


async def snooze(
    session: AsyncSession, order_item_id: UUID, stage_code: str, *, hours: int
) -> dict | None:
    """Push a stage's reminder out by `hours` and un-claim it so it can fire again.

    Clearing `reminded_at` is the point: without it the row would never be picked up
    again and Snooze would be a mute button wearing a snooze label.
    """
    result = await session.execute(
        text(
            "UPDATE order_item_stage_plan"
            "   SET snoozed_until = now() + make_interval(hours => :hours),"
            "       reminded_at = NULL"
            " WHERE order_item_id = :item AND stage_code = :stage"
            f" RETURNING {', '.join(_FIELDS)}"
        ),
        {"item": str(order_item_id), "stage": stage_code, "hours": hours},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def due_state_for_items(
    session: AsyncSession, order_item_ids: list[str]
) -> dict[str, dict]:
    """`{order_item_id: {stage_code, due_at, overdue}}` for the PWA's queue cards.

    The item's NEXT unfinished stage deadline, one row per item — the queue shows one
    pill per card, so returning the whole plan for forty cards would be waste. Uses the
    same "stage not already done" exclusion as due_reminders so the pill and the WhatsApp
    can never disagree.
    """
    if not order_item_ids:
        return {}
    result = await session.execute(
        text(
            "SELECT DISTINCT ON (p.order_item_id)"
            "       p.order_item_id, p.stage_code, p.due_at, p.snoozed_until,"
            "       sd.label_en AS stage_label_en, sd.label_gu AS stage_label_gu,"
            "       p.due_at <= now() AS overdue"
            " FROM order_item_stage_plan p"
            " JOIN production_stage_defs sd ON sd.code = p.stage_code"
            " WHERE p.order_item_id = ANY(:ids) AND p.skipped = false"
            "   AND p.due_at IS NOT NULL"
            "   AND NOT EXISTS (SELECT 1 FROM production_events e"
            "                    WHERE e.order_item_id = p.order_item_id"
            "                      AND e.stage_code = p.stage_code AND e.kind = 'done')"
            " ORDER BY p.order_item_id, sd.sort"
        ),
        {"ids": order_item_ids},
    )
    return {str(m["order_item_id"]): dict(m) for m in result.mappings().all()}
