"""Pure route planning: validate a multi-workshop plan and compute its deadlines.

A ROUTE is an ordered list of legs, each leg = (workshop, stage span, planned days).
The client's example is two legs: "polishing in one workshop within 5 days then to
finishing up to another workshop within 4 days".

What this module guarantees, before any row is written:

  1. **The span cover is contiguous and complete.** Leg n+1 starts at the stage
     immediately after leg n's stage_to, the first leg starts where the item actually
     is, and the last leg reaches the final stage. A gap means stages nobody owns; an
     overlap means two workshops both think they are cutting the same frame.
  2. **Adjacent legs sit at different workshops.** Two consecutive legs at one site is
     a transfer to itself, which 0031's `workshop_transfers_distinct_sites` CHECK
     rejects — better to refuse it here with a sentence the operator can act on.
  3. **Deadlines are monotonic and carry a TIME.** The client asked for the time the
     goods are due, not just the day. Due instants are cumulative over `planned_days`
     and land at 18:00 IST unless the operator typed something else.

No DB, no I/O — the reason this is the layer the tests hammer.
"""

from dataclasses import dataclass, replace
from datetime import datetime, time, timedelta, timezone

from . import stage_flow
from .stage_flow import Stage

# The showroom is in Surat. Deadlines are read off a phone in IST, so a deadline
# computed in UTC would drift a whole working day for anything after 18:30 local.
IST = timezone(timedelta(hours=5, minutes=30))

# End of the working day. Not a literal at a decision point — override per call.
DEFAULT_DUE_HOUR = 18


class RoutePlanError(ValueError):
    """A route is not plannable. The message is user-facing (shown in the builder)."""


@dataclass(frozen=True)
class LegSpec:
    """One leg as the operator typed it. `planned_days` and `due_at` are both
    optional: supply days and the deadline is computed, or supply the deadline
    directly and days are informational."""

    workshop_id: str
    stage_from: str
    stage_to: str
    planned_days: int | None = None
    due_at: datetime | None = None


@dataclass(frozen=True)
class PlannedLeg:
    """A leg with its sequence and resolved deadline — ready to INSERT."""

    seq: int
    workshop_id: str
    stage_from: str
    stage_to: str
    planned_days: int | None
    due_at: datetime | None


def at_ist_hour(moment: datetime, hour: int = DEFAULT_DUE_HOUR) -> datetime:
    """`moment`'s calendar day in IST, at `hour`:00 IST, returned as an aware UTC
    instant. Naive input is read as IST (that is what an operator typing into the
    builder means)."""
    if moment.tzinfo is None:
        local = moment.replace(tzinfo=IST)
    else:
        local = moment.astimezone(IST)
    stamped = datetime.combine(local.date(), time(hour=hour), tzinfo=IST)
    return stamped.astimezone(timezone.utc)


def validate_cover(
    stages: tuple[Stage, ...],
    legs: list[LegSpec],
    *,
    start_stage: str,
    final_stage: str | None = None,
) -> None:
    """Raise RoutePlanError unless the legs tile [start_stage, final_stage] exactly.

    `final_stage` defaults to the last active stage. Passing it explicitly is for
    tests and for a future partial-route feature — today a route that stops short is
    refused, because the tail stages would belong to no workshop and the item could
    never reach `production_done_at`.
    """
    if not stages:
        raise RoutePlanError("No production stages are defined")
    if not legs:
        raise RoutePlanError("A route needs at least one leg")

    known = stage_flow.by_code(stages)
    target_end = final_stage or stage_flow.last_code(stages)

    for i, leg in enumerate(legs, start=1):
        if leg.stage_from not in known:
            raise RoutePlanError(f"Leg {i}: unknown stage '{leg.stage_from}'")
        if leg.stage_to not in known:
            raise RoutePlanError(f"Leg {i}: unknown stage '{leg.stage_to}'")
        if not stage_flow.codes_in_span(stages, leg.stage_from, leg.stage_to):
            raise RoutePlanError(
                f"Leg {i}: '{leg.stage_from}' comes after '{leg.stage_to}' — "
                "a leg's stages must run forwards"
            )
        if leg.planned_days is not None and leg.planned_days <= 0:
            raise RoutePlanError(f"Leg {i}: days must be at least 1")

    if legs[0].stage_from != start_stage:
        raise RoutePlanError(
            f"Leg 1 must start at '{start_stage}', the stage this item is currently at"
        )

    for i in range(len(legs) - 1):
        expected = stage_flow.next_code(stages, legs[i].stage_to)
        actual = legs[i + 1].stage_from
        if expected is None:
            raise RoutePlanError(
                f"Leg {i + 1} already ends at the final stage — leg {i + 2} has nothing to do"
            )
        if actual != expected:
            raise RoutePlanError(
                f"Leg {i + 2} must start at '{expected}' (the stage right after leg "
                f"{i + 1}'s '{legs[i].stage_to}'), not '{actual}'"
            )
        if legs[i].workshop_id == legs[i + 1].workshop_id:
            raise RoutePlanError(
                f"Legs {i + 1} and {i + 2} are the same workshop — merge them into one "
                "leg instead of transferring the goods to where they already are"
            )

    if target_end is not None and legs[-1].stage_to != target_end:
        raise RoutePlanError(
            f"The last leg must reach '{target_end}' — stages after "
            f"'{legs[-1].stage_to}' would belong to no workshop"
        )


def compute_due_ats(
    legs: list[LegSpec],
    *,
    start_at: datetime,
    due_hour: int = DEFAULT_DUE_HOUR,
) -> tuple[PlannedLeg, ...]:
    """Resolve each leg's deadline, cumulatively.

    Leg 1 is due `planned_days` after `start_at`; leg 2 that many days after leg 1;
    and so on — "5 days polishing then 4 days finishing" means the item is due at the
    second workshop on day 9, not day 4. An explicit `due_at` on a leg wins outright
    and becomes the cursor for the legs after it, so an operator can pin one hard
    customer commitment mid-route and let the rest fall out of it.

    A leg with neither days nor an explicit instant gets `due_at = None`: honest, and
    the watchdog skips it rather than counting days against nobody (0024's rule for
    unallocated items).
    """
    planned: list[PlannedLeg] = []
    cursor = start_at
    for i, leg in enumerate(legs, start=1):
        if leg.due_at is not None:
            due = leg.due_at
            cursor = due
        elif leg.planned_days is not None:
            cursor = cursor + timedelta(days=leg.planned_days)
            due = at_ist_hour(cursor, due_hour)
            cursor = due
        else:
            due = None
        planned.append(
            PlannedLeg(
                seq=i,
                workshop_id=leg.workshop_id,
                stage_from=leg.stage_from,
                stage_to=leg.stage_to,
                planned_days=leg.planned_days,
                due_at=due,
            )
        )
    _assert_monotonic(planned)
    return tuple(planned)


def _assert_monotonic(planned: list[PlannedLeg]) -> None:
    """Deadlines may not move backwards down the route. Only reachable when the
    operator pinned explicit instants out of order — the computed path cannot
    produce it — and it is worth a clear refusal because the alternative is a
    permanently-overdue leg nobody can clear."""
    previous: datetime | None = None
    for leg in planned:
        if leg.due_at is None:
            continue
        if previous is not None and leg.due_at < previous:
            raise RoutePlanError(
                f"Leg {leg.seq}'s deadline is before leg {leg.seq - 1}'s — "
                "the goods cannot be due at the next workshop before they leave this one"
            )
        previous = leg.due_at


def plan_route(
    stages: tuple[Stage, ...],
    legs: list[LegSpec],
    *,
    start_stage: str,
    start_at: datetime,
    due_hour: int = DEFAULT_DUE_HOUR,
) -> tuple[PlannedLeg, ...]:
    """Validate then resolve. The single entry point api/routing.py calls."""
    validate_cover(stages, legs, start_stage=start_stage)
    return compute_due_ats(legs, start_at=start_at, due_hour=due_hour)


def reflow(
    planned: tuple[PlannedLeg, ...],
    *,
    from_at: datetime,
    reflow_from_seq: int,
    due_hour: int = DEFAULT_DUE_HOUR,
) -> tuple[PlannedLeg, ...]:
    """Recompute the deadlines of legs at or after `reflow_from_seq`, starting from
    `from_at`. Legs before it keep the deadlines they were judged against.

    This is the ONLY way a downstream deadline moves (module 14 D11, client-confirmed
    2026-07-27): a late leg does NOT silently slide the rest of the route, because a
    due date is a commitment derived from the customer's delivery date and quietly
    moving it destroys the only signal that the order is running late. Reflow is an
    explicit owner/admin action and is audited by the caller.

    A leg with no `planned_days` keeps whatever deadline it had — there is nothing to
    recompute from.
    """
    out: list[PlannedLeg] = []
    cursor = from_at
    for leg in planned:
        if leg.seq < reflow_from_seq:
            out.append(leg)
            if leg.due_at is not None:
                cursor = max(cursor, leg.due_at)
            continue
        if leg.planned_days is None:
            out.append(leg)
            continue
        cursor = cursor + timedelta(days=leg.planned_days)
        cursor = at_ist_hour(cursor, due_hour)
        out.append(replace(leg, due_at=cursor))
    _assert_monotonic(out)
    return tuple(out)
