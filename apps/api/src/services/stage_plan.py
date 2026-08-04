"""Pure per-stage day budgets: validate a plan and compute its due instants (0035).

A STAGE PLAN is one row per production stage for one order item: how many days it should
take, whether it is skipped, whether it reminds. It is the foreman's schedule INSIDE the
item's deadline — the client's ask was "set days per stage, skip the ones that don't
apply, remind me when one is due".

What this module guarantees before any row is written:

  1. **The days fit.** The non-skipped stages' days must not add up past the item's
     actual due date (`order_item_assignments.due_date`). That is the whole point of a
     budget: a plan that overruns the customer's promised date is a plan that lies.
  2. **A skipped stage consumes nothing.** No days, no due date, no reminder.
  3. **Due instants are cumulative and land at end of the working day IST**, the same
     convention route legs use — so a stage deadline and a leg deadline read alike.
  4. **No stage overruns the leg that owns it.** Legs stay authoritative for handover
     (0030/0035 headers); a stage plan that finishes `polishing` after the polishing
     workshop was due to ship is internally inconsistent, and the operator is told
     which stage and why rather than discovering it as a late consignment.

Why here and not in a trigger: rules 1 and 4 are CROSS-ROW over a plan written as one
replace-all transaction, and a row-level trigger cannot see its uncommitted siblings —
the same reasoning 0030 records for the route-leg span rules.

No DB, no I/O. This is the layer the tests hammer.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from .route_plan import IST, at_ist_hour

# Re-exported so a caller does not need to know the deadline convention lives in
# route_plan — it is one convention shared by legs and stages, deliberately.
__all__ = [
    "IST",
    "PlanRow",
    "PlannedStage",
    "cumulative_dues",
    "scale_to_budget",
    "seed_from_defaults",
    "validate_plan",
]


@dataclass(frozen=True)
class PlanRow:
    """One stage as the operator typed it."""

    stage_code: str
    planned_days: int | None = None
    skipped: bool = False
    remind: bool = True


@dataclass(frozen=True)
class PlannedStage:
    """A row with its resolved deadline — ready to INSERT."""

    stage_code: str
    planned_days: int | None
    skipped: bool
    remind: bool
    due_at: datetime | None


def _ordered(rows: list[PlanRow], stage_order: list[str]) -> list[PlanRow]:
    """Rows in STAGE order, ignoring the order the client sent them in.

    Cumulative dates are meaningless in payload order, and a browser that reorders its
    form fields must not be able to change what the dates mean. Unknown codes are
    dropped here and rejected by name in validate_plan(), so an unknown stage produces a
    sentence rather than a silent misplacement.
    """
    position = {code: i for i, code in enumerate(stage_order)}
    known = [r for r in rows if r.stage_code in position]
    return sorted(known, key=lambda r: position[r.stage_code])


def active_rows(rows: list[PlanRow]) -> list[PlanRow]:
    """The stages that consume time."""
    return [r for r in rows if not r.skipped]


def total_days(rows: list[PlanRow]) -> int:
    return sum(r.planned_days or 0 for r in active_rows(rows))


def budget_days(*, start_date: date, due_date: date | None) -> int | None:
    """Days available between today (or the allocation date) and the item's deadline.

    None when the item has no due date — there is nothing to overrun, so the sum rule
    does not apply and the plan is pure reminder scheduling.
    """
    if due_date is None:
        return None
    return (due_date - start_date).days


def cumulative_dues(
    rows: list[PlanRow],
    *,
    start_at: datetime,
    stage_order: list[str],
    due_hour: int | None = None,
) -> tuple[PlannedStage, ...]:
    """Resolve each stage's deadline, cumulatively, in stage order.

    "3 days cutting then 2 days frame work" means frame work is due on day 5, not day 2.
    A skipped stage advances nothing and gets `due_at = None`. A stage with no day count
    also gets None — honest, and the reminder scan skips it rather than nagging about a
    deadline nobody set (0024's rule for unallocated items).
    """
    planned: list[PlannedStage] = []
    cursor = start_at
    for row in _ordered(rows, stage_order):
        if row.skipped or row.planned_days is None:
            planned.append(
                PlannedStage(
                    stage_code=row.stage_code,
                    planned_days=None if row.skipped else row.planned_days,
                    skipped=row.skipped,
                    remind=row.remind,
                    due_at=None,
                )
            )
            continue
        cursor = cursor + timedelta(days=row.planned_days)
        due = at_ist_hour(cursor, due_hour) if due_hour is not None else at_ist_hour(cursor)
        cursor = due
        planned.append(
            PlannedStage(
                stage_code=row.stage_code,
                planned_days=row.planned_days,
                skipped=False,
                remind=row.remind,
                due_at=due,
            )
        )
    return tuple(planned)


def validate_plan(
    rows: list[PlanRow],
    *,
    stage_order: list[str],
    start_date: date,
    due_date: date | None = None,
    leg_dues: dict[str, datetime] | None = None,
    start_at: datetime | None = None,
) -> list[str]:
    """Every problem with this plan, as sentences an operator can act on.

    Returns a LIST rather than raising on the first fault: an owner filling in eleven day
    counts wants to see all of the mistakes at once, not to resubmit eleven times.
    Empty list = valid.
    """
    errors: list[str] = []
    known = set(stage_order)

    unknown = sorted({r.stage_code for r in rows if r.stage_code not in known})
    if unknown:
        errors.append(f"Unknown stage(s): {', '.join(unknown)}")

    counts: dict[str, int] = {}
    for row in rows:
        counts[row.stage_code] = counts.get(row.stage_code, 0) + 1
    duplicates = sorted(code for code, n in counts.items() if n > 1)
    if duplicates:
        errors.append(f"Each stage may appear once — repeated: {', '.join(duplicates)}")

    ordered = _ordered(rows, stage_order)
    live = active_rows(ordered)

    if any(r.planned_days is None or r.planned_days <= 0 for r in live):
        errors.append("Every stage that is not skipped needs at least 1 day")
    if any(r.skipped and r.planned_days for r in ordered):
        errors.append("A skipped stage cannot also have days — clear the days or un-skip it")
    if not live:
        errors.append("At least one stage must be planned — skipping all of them plans nothing")

    budget = budget_days(start_date=start_date, due_date=due_date)
    used = total_days(ordered)
    if budget is not None:
        if budget <= 0:
            errors.append(
                f"The due date ({due_date:%d %b %Y}) is not in the future — "
                "there are no days left to plan"
            )
        elif used > budget:
            errors.append(
                f"Stage days total {used}, but only {budget} day(s) remain until the due "
                f"date ({due_date:%d %b %Y}) — remove {used - budget} day(s)"
            )

    # Rule 4: legs stay authoritative. Only checked when the caller supplied the legs;
    # a legacy single-workshop allocation has none.
    if leg_dues:
        cursor_start = start_at or datetime.combine(start_date, datetime.min.time(), tzinfo=IST)
        for stage in cumulative_dues(ordered, start_at=cursor_start, stage_order=stage_order):
            leg_due = leg_dues.get(stage.stage_code)
            if stage.due_at is not None and leg_due is not None and stage.due_at > leg_due:
                errors.append(
                    f"'{stage.stage_code}' would finish on {stage.due_at.astimezone(IST):%d %b}, "
                    f"after its workshop is due to hand the goods on "
                    f"({leg_due.astimezone(IST):%d %b}) — shorten the earlier stages"
                )

    return errors


def scale_to_budget(rows: list[PlanRow], *, budget: int | None) -> tuple[list[PlanRow], bool]:
    """Shrink a plan proportionally so it fits `budget`. Returns (rows, was_scaled).

    Used ONLY when seeding from the admin defaults at allocation time: the defaults are
    a generic recipe and the order in front of us may be due sooner than the recipe
    takes. Refusing the allocation over a reminder plan would be absurd, and seeding an
    already-overrunning plan would put every stage instantly overdue — so it is squeezed,
    and the caller logs that it happened.

    Every active stage keeps at least one day; if the budget cannot even cover one day
    per stage, the plan comes back unscaled and validate_plan() will say so.
    """
    live = active_rows(rows)
    used = sum(r.planned_days or 0 for r in live)
    if budget is None or used <= budget or budget < len(live) or not live:
        return list(rows), False

    ratio = budget / used
    scaled: list[PlanRow] = []
    for row in rows:
        if row.skipped or row.planned_days is None:
            scaled.append(row)
            continue
        scaled.append(
            PlanRow(
                stage_code=row.stage_code,
                planned_days=max(1, int(row.planned_days * ratio)),
                skipped=False,
                remind=row.remind,
            )
        )
    return scaled, True


def seed_from_defaults(stage_defs: list[dict]) -> list[PlanRow]:
    """The starting plan for a freshly-allocated item, from `default_days` (0035).

    A stage the owner has not costed (`default_days IS NULL`) is seeded as SKIPPED rather
    than as a zero-day stage: zero days is not a duration, and a NULL-day active row
    would fail validation on the operator's first save through no fault of theirs. They
    un-skip and type a number when they mean it to count.
    """
    rows: list[PlanRow] = []
    for stage in sorted(stage_defs, key=lambda s: int(s["sort"])):
        days = stage.get("default_days")
        rows.append(
            PlanRow(
                stage_code=str(stage["code"]),
                planned_days=int(days) if days else None,
                skipped=not days,
                remind=bool(days),
            )
        )
    return rows
