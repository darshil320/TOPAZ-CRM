"""Stage-plan repository — per-item day budgets and their reminder state (0035).

Service-role writes only: 0035 grants `authenticated` SELECT and nothing else, because
the plan's defining invariant (the days must not add up past the item's due date) spans
every row of the plan and a browser inserting one row could not be checked against it.
api/stage_plan.py is the authz boundary; this module is only SQL.

Two write shapes, both deliberate:

  * `replace_plan` — DELETE then INSERT inside the caller's transaction. The plan is
    never half-written, so the sum invariant holds at every commit.
  * `claim_reminder` — `UPDATE … WHERE reminded_at < today RETURNING id`. That is the
    ONCE-PER-DAY guarantee for the WhatsApp reminder (0045): an hourly Celery tick, or a
    retry after a partial failure, claims nothing for a row already nagged about today.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_FIELDS = (
    "id", "order_item_id", "stage_code", "planned_days", "skipped", "remind",
    "due_at", "reminded_at", "reminder_count", "snoozed_until", "created_by",
    "created_at", "updated_at",
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
# Start of TODAY in IST, as a UTC timestamptz. THE daily de-duplication boundary (0045).
#
# Why not `reminded_at < now() - interval '24 hours'`: a rolling 24h window drifts. Fire
# at 09:05 today and the row is ineligible until 09:05 tomorrow, so with an hourly beat
# the reminder walks later every day and eventually crosses midnight, skipping a calendar
# day entirely. Anchoring to the IST calendar day makes "once a day" mean what the owner
# means by it, and makes the FIRST tick after midnight the one that fires.
_IST_TODAY_START = "(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')"

# Ceiling on repeats for one stage. MUST match order_item_stage_plan_due_idx's predicate
# in migration 0045 — the index is partial on this value, so changing it here alone would
# leave exhausted rows in the index and rows past the new cap outside it.
MAX_REMINDERS = 14


async def due_reminders(session: AsyncSession, *, limit: int = 100) -> list[dict]:
    """Stage deadlines that have passed, not yet reminded about TODAY (0045).

    Every predicate is covered by order_item_stage_plan_due_idx (rebuilt in 0045), so the
    hourly beat stays an index probe.

    Excluded, and why:
      * `skipped` / `remind = false`     — the operator said no.
      * reminded already TODAY (IST)     — the daily repeat rule. Not `reminded_at IS
        NULL` (0035's single-fire rule): a stage that is still unfinished must keep
        asking, once per calendar day, which is the whole point of this change.
      * `reminder_count >= MAX_REMINDERS` — a nag with no ceiling is how a shop floor
        learns to mute WhatsApp. After two weeks the daily message has demonstrably
        stopped working and the dashboard alert is the remaining record.
      * `snoozed_until > now()`          — the manager asked for four more hours.
      * `production_done_at IS NOT NULL` — the item is finished; the schedule is moot.
      * a stage already marked done       — "until he's past that stage". THIS is the
        predicate that ends the daily repeat: the moment the workshop marks the stage
        done, the row stops matching and the reminders stop.

    Blocked items are INCLUDED: a blocked item is exactly the one whose slipping deadline
    the owner needs to hear about (same call as route_repo.overdue_active_legs).
    """
    result = await session.execute(
        text(
            "SELECT p.id, p.order_item_id, p.stage_code, p.due_at, p.planned_days,"
            "       p.reminder_count,"
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
            "   AND p.due_at IS NOT NULL AND p.due_at <= now()"
            "   AND p.reminder_count < :max_reminders"
            f"   AND (p.reminded_at IS NULL OR p.reminded_at < {_IST_TODAY_START})"
            "   AND (p.snoozed_until IS NULL OR p.snoozed_until <= now())"
            "   AND oi.production_done_at IS NULL"
            "   AND NOT EXISTS (SELECT 1 FROM production_events e"
            "                    WHERE e.order_item_id = p.order_item_id"
            "                      AND e.stage_code = p.stage_code AND e.kind = 'done')"
            " ORDER BY p.due_at LIMIT :limit"
        ),
        {"limit": limit, "max_reminders": MAX_REMINDERS},
    )
    return [dict(m) for m in result.mappings().all()]


async def claim_reminder(session: AsyncSession, plan_id: UUID | str) -> int | None:
    """Stamp `reminded_at`, bump the counter, and report OUR new count — or None.

    THE once-per-day guarantee (0045). The `reminded_at < today` predicate is re-checked
    inside the UPDATE, not just in due_reminders' SELECT: between the scan and the claim
    another worker (or the hourly tick that overlapped a slow batch) may have already
    nagged about this row today, and only an atomic conditional update can settle who
    actually sends. `RETURNING reminder_count` hands the caller the post-increment value
    so the message can say which day of nagging this is without a second read.

    Called BEFORE the WhatsApp send: if the send then fails, the row stays claimed and
    that day's reminder is lost. Under 0035's single-fire rule that meant losing the
    reminder outright; now it costs one day and tomorrow's tick asks again, which is the
    strictly better failure mode this change buys.
    """
    result = await session.execute(
        text(
            "UPDATE order_item_stage_plan"
            "   SET reminded_at = now(), reminder_count = reminder_count + 1"
            " WHERE id = :id"
            "   AND reminder_count < :max_reminders"
            f"   AND (reminded_at IS NULL OR reminded_at < {_IST_TODAY_START})"
            " RETURNING reminder_count"
        ),
        {"id": str(plan_id), "max_reminders": MAX_REMINDERS},
    )
    row = result.first()
    return None if row is None else int(row[0])


async def snooze(
    session: AsyncSession, order_item_id: UUID, stage_code: str, *, hours: int
) -> dict | None:
    """Push a stage's reminder out by `hours` and un-claim it so it can fire again.

    Clearing `reminded_at` is the point: without it the row would never be picked up
    again and Snooze would be a mute button wearing a snooze label. Under the daily
    repeat rule (0045) it does a second job — it lets the reminder fire again TODAY once
    the snooze expires, instead of the manager's "four more hours" silently costing them
    the rest of the day.

    `reminder_count` is deliberately NOT reset. It counts how many times this deadline
    has been raised, and snoozing is not the work getting done — resetting it would make
    Snooze an unlimited mute (snooze, fire, snooze, fire, forever) and would erase the
    escalation signal the count exists to carry. The cap therefore still bounds the
    total nags per stage no matter how often the row is snoozed.
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
