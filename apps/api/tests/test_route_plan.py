"""Pure tests for services/route_plan.py — the multi-workshop route validator and the
cumulative due-date-AND-TIME computation. No DB, no ML deps.

The scenario throughout is the client's own: polishing at one workshop within 5 days,
then finishing at another within 4 days.
"""

from datetime import datetime, timedelta, timezone

import pytest

from src.services import stage_flow as sf
from src.services import route_plan as rp
from src.services.route_plan import IST, LegSpec, RoutePlanError

ROWS = [
    {"code": "design_approved", "sort": 10},
    {"code": "cutting", "sort": 30},
    {"code": "frame_work", "sort": 40},
    {"code": "polishing", "sort": 70},
    {"code": "finishing", "sort": 80},
    {"code": "dispatch", "sort": 110},
]

WS_A = "11111111-1111-1111-1111-111111111111"
WS_B = "22222222-2222-2222-2222-222222222222"

# 2026-07-27 10:00 IST
START = datetime(2026, 7, 27, 10, 0, tzinfo=IST)


@pytest.fixture
def stages():
    return sf.to_stages(ROWS)


def full_route() -> list[LegSpec]:
    """A valid two-leg cover of the whole chain."""
    return [
        LegSpec(WS_A, "design_approved", "polishing", planned_days=5),
        LegSpec(WS_B, "finishing", "dispatch", planned_days=4),
    ]


# ─── Cover validation ────────────────────────────────────────────────────────
def test_the_client_scenario_validates(stages):
    rp.validate_cover(stages, full_route(), start_stage="design_approved")


def test_empty_route_refused(stages):
    with pytest.raises(RoutePlanError, match="at least one leg"):
        rp.validate_cover(stages, [], start_stage="design_approved")


def test_gap_between_legs_refused(stages):
    legs = [
        LegSpec(WS_A, "design_approved", "cutting", planned_days=5),
        # frame_work and polishing belong to nobody
        LegSpec(WS_B, "finishing", "dispatch", planned_days=4),
    ]
    with pytest.raises(RoutePlanError, match="must start at 'frame_work'"):
        rp.validate_cover(stages, legs, start_stage="design_approved")


def test_overlap_between_legs_refused(stages):
    legs = [
        LegSpec(WS_A, "design_approved", "finishing", planned_days=5),
        LegSpec(WS_B, "polishing", "dispatch", planned_days=4),  # re-does polishing
    ]
    with pytest.raises(RoutePlanError, match="must start at 'dispatch'"):
        rp.validate_cover(stages, legs, start_stage="design_approved")


def test_backwards_span_within_one_leg_refused(stages):
    legs = [LegSpec(WS_A, "finishing", "cutting", planned_days=5)]
    with pytest.raises(RoutePlanError, match="must run forwards"):
        rp.validate_cover(stages, legs, start_stage="finishing")


def test_route_that_does_not_start_where_the_item_is_refused(stages):
    # Item is mid-production at frame_work; a route starting at design_approved would
    # hand a workshop stages that are already done.
    with pytest.raises(RoutePlanError, match="must start at 'frame_work'"):
        rp.validate_cover(stages, full_route(), start_stage="frame_work")


def test_route_stopping_short_of_the_final_stage_refused(stages):
    legs = [
        LegSpec(WS_A, "design_approved", "polishing", planned_days=5),
        LegSpec(WS_B, "finishing", "finishing", planned_days=4),  # dispatch orphaned
    ]
    with pytest.raises(RoutePlanError, match="must reach 'dispatch'"):
        rp.validate_cover(stages, legs, start_stage="design_approved")


def test_two_consecutive_legs_at_the_same_workshop_refused(stages):
    legs = [
        LegSpec(WS_A, "design_approved", "polishing", planned_days=5),
        LegSpec(WS_A, "finishing", "dispatch", planned_days=4),
    ]
    with pytest.raises(RoutePlanError, match="same workshop"):
        rp.validate_cover(stages, legs, start_stage="design_approved")


def test_unknown_stage_refused(stages):
    legs = [LegSpec(WS_A, "design_approved", "sanding", planned_days=5)]
    with pytest.raises(RoutePlanError, match="unknown stage 'sanding'"):
        rp.validate_cover(stages, legs, start_stage="design_approved")


def test_zero_days_refused(stages):
    legs = [LegSpec(WS_A, "design_approved", "dispatch", planned_days=0)]
    with pytest.raises(RoutePlanError, match="at least 1"):
        rp.validate_cover(stages, legs, start_stage="design_approved")


def test_single_leg_covering_everything_is_valid(stages):
    rp.validate_cover(
        stages,
        [LegSpec(WS_A, "design_approved", "dispatch", planned_days=9)],
        start_stage="design_approved",
    )


# ─── Deadlines: date AND time, cumulative ────────────────────────────────────
def test_days_accumulate_across_legs_not_reset(stages):
    planned = rp.compute_due_ats(full_route(), start_at=START)
    # 5 days polishing → 1 Aug; then 4 more → 5 Aug (NOT 31 Jul).
    assert planned[0].due_at.astimezone(IST).date().isoformat() == "2026-08-01"
    assert planned[1].due_at.astimezone(IST).date().isoformat() == "2026-08-05"


def test_deadline_carries_a_time_at_end_of_the_ist_working_day():
    planned = rp.compute_due_ats(full_route(), start_at=START)
    local = planned[0].due_at.astimezone(IST)
    assert (local.hour, local.minute) == (rp.DEFAULT_DUE_HOUR, 0)


def test_due_at_is_returned_as_an_aware_utc_instant():
    planned = rp.compute_due_ats(full_route(), start_at=START)
    assert planned[0].due_at.tzinfo is not None
    assert planned[0].due_at.utcoffset() == timedelta(0)


def test_due_hour_is_configurable_not_hardcoded():
    planned = rp.compute_due_ats(full_route(), start_at=START, due_hour=11)
    assert planned[0].due_at.astimezone(IST).hour == 11


def test_naive_start_is_read_as_ist_not_utc():
    naive = rp.compute_due_ats(full_route(), start_at=datetime(2026, 7, 27, 10, 0))
    aware = rp.compute_due_ats(full_route(), start_at=START)
    assert naive[0].due_at == aware[0].due_at


def test_explicit_due_at_wins_and_becomes_the_cursor():
    pinned = datetime(2026, 8, 10, 12, 0, tzinfo=IST)
    legs = [
        LegSpec(WS_A, "design_approved", "polishing", due_at=pinned),
        LegSpec(WS_B, "finishing", "dispatch", planned_days=4),
    ]
    planned = rp.compute_due_ats(legs, start_at=START)
    assert planned[0].due_at == pinned
    # Leg 2 counts from the PINNED instant, not from start_at.
    assert planned[1].due_at.astimezone(IST).date().isoformat() == "2026-08-14"


def test_leg_with_neither_days_nor_instant_gets_no_deadline():
    legs = [
        LegSpec(WS_A, "design_approved", "polishing"),
        LegSpec(WS_B, "finishing", "dispatch", planned_days=4),
    ]
    planned = rp.compute_due_ats(legs, start_at=START)
    assert planned[0].due_at is None
    # The cursor did not move, so leg 2 is 4 days after start.
    assert planned[1].due_at.astimezone(IST).date().isoformat() == "2026-07-31"


def test_deadlines_may_not_run_backwards():
    legs = [
        LegSpec(WS_A, "design_approved", "polishing",
                due_at=datetime(2026, 8, 20, 12, 0, tzinfo=IST)),
        LegSpec(WS_B, "finishing", "dispatch",
                due_at=datetime(2026, 8, 10, 12, 0, tzinfo=IST)),
    ]
    with pytest.raises(RoutePlanError, match="cannot be due at the next workshop"):
        rp.compute_due_ats(legs, start_at=START)


def test_seq_is_one_based_and_dense():
    planned = rp.compute_due_ats(full_route(), start_at=START)
    assert [leg.seq for leg in planned] == [1, 2]


def test_plan_route_validates_before_computing(stages):
    legs = [LegSpec(WS_A, "design_approved", "cutting", planned_days=5)]
    with pytest.raises(RoutePlanError):
        rp.plan_route(stages, legs, start_stage="design_approved", start_at=START)


# ─── at_ist_hour edge: the date-boundary bug this exists to prevent ──────────
def test_late_evening_utc_still_lands_on_the_ist_calendar_day():
    # 2026-07-30 20:00 UTC is already 2026-07-31 01:30 IST.
    moment = datetime(2026, 7, 30, 20, 0, tzinfo=timezone.utc)
    due = rp.at_ist_hour(moment)
    assert due.astimezone(IST).date().isoformat() == "2026-07-31"


# ─── Reflow (D11) ────────────────────────────────────────────────────────────
def test_reflow_moves_only_legs_at_or_after_the_pivot():
    planned = rp.compute_due_ats(full_route(), start_at=START)
    late = datetime(2026, 8, 6, 9, 0, tzinfo=IST)
    reflowed = rp.reflow(planned, from_at=late, reflow_from_seq=2)
    assert reflowed[0].due_at == planned[0].due_at          # untouched
    assert reflowed[1].due_at.astimezone(IST).date().isoformat() == "2026-08-10"


def test_reflow_from_the_first_leg_replans_everything():
    planned = rp.compute_due_ats(full_route(), start_at=START)
    late = datetime(2026, 8, 6, 9, 0, tzinfo=IST)
    reflowed = rp.reflow(planned, from_at=late, reflow_from_seq=1)
    assert reflowed[0].due_at.astimezone(IST).date().isoformat() == "2026-08-11"
    assert reflowed[1].due_at.astimezone(IST).date().isoformat() == "2026-08-15"


def test_reflow_leaves_a_dayless_leg_alone():
    legs = [
        LegSpec(WS_A, "design_approved", "polishing", planned_days=5),
        LegSpec(WS_B, "finishing", "dispatch"),
    ]
    planned = rp.compute_due_ats(legs, start_at=START)
    reflowed = rp.reflow(planned, from_at=datetime(2026, 8, 6, 9, 0, tzinfo=IST),
                         reflow_from_seq=2)
    assert reflowed[1].due_at is None
