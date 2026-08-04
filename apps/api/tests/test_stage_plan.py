"""Pure tests for services/stage_plan.py — the per-stage day budget (0035).

No DB, no ML deps: this file must pass on a bare `pip install pytest`.
"""

from datetime import date, datetime, timedelta

import pytest

from src.services import stage_plan as sp
from src.services.stage_plan import IST, PlanRow

# Stage order as production_stage_defs seeds it (sort in tens, non-contiguous).
ORDER = ["cutting", "frame_work", "upholstery", "polishing", "finishing"]

STAGE_DEFS = [
    {"code": "cutting", "sort": 30, "default_days": 2},
    {"code": "frame_work", "sort": 40, "default_days": 3},
    {"code": "upholstery", "sort": 60, "default_days": None},
    {"code": "polishing", "sort": 70, "default_days": 4},
    {"code": "finishing", "sort": 80, "default_days": 1},
]

START = date(2026, 8, 4)
START_AT = datetime(2026, 8, 4, 10, 0, tzinfo=IST)


def plan(**days: int | None) -> list[PlanRow]:
    """A plan from keyword day counts; a None value means 'skipped'."""
    return [
        PlanRow(stage_code=code, planned_days=days[code], skipped=days[code] is None)
        for code in ORDER
        if code in days
    ]


# ─── The sum rule ────────────────────────────────────────────────────────────
def test_a_plan_inside_the_budget_is_valid():
    rows = plan(cutting=2, frame_work=3, upholstery=None, polishing=4, finishing=1)
    assert sp.validate_plan(
        rows, stage_order=ORDER, start_date=START, due_date=START + timedelta(days=20)
    ) == []


def test_a_plan_that_overruns_the_due_date_says_by_how_much():
    rows = plan(cutting=5, frame_work=5, upholstery=None, polishing=5, finishing=5)
    errors = sp.validate_plan(
        rows, stage_order=ORDER, start_date=START, due_date=START + timedelta(days=10)
    )
    assert len(errors) == 1
    assert "total 20" in errors[0]
    assert "only 10 day(s)" in errors[0]
    assert "remove 10 day(s)" in errors[0]


def test_exactly_filling_the_budget_is_allowed():
    rows = plan(cutting=5, frame_work=5)
    assert sp.validate_plan(
        rows, stage_order=ORDER, start_date=START, due_date=START + timedelta(days=10)
    ) == []


def test_no_due_date_means_no_sum_rule():
    """An item with no deadline can still have a reminder schedule."""
    rows = plan(cutting=99, frame_work=99)
    assert sp.validate_plan(rows, stage_order=ORDER, start_date=START, due_date=None) == []


def test_a_due_date_already_past_is_refused_with_its_own_message():
    rows = plan(cutting=1)
    errors = sp.validate_plan(
        rows, stage_order=ORDER, start_date=START, due_date=START - timedelta(days=1)
    )
    assert any("no days left to plan" in e for e in errors)


# ─── Skipped stages ──────────────────────────────────────────────────────────
def test_skipped_stages_consume_no_days():
    rows = plan(cutting=5, upholstery=None, polishing=5)
    assert sp.total_days(rows) == 10
    assert sp.validate_plan(
        rows, stage_order=ORDER, start_date=START, due_date=START + timedelta(days=10)
    ) == []


def test_skipped_stage_gets_no_due_date():
    rows = plan(cutting=2, upholstery=None, polishing=1)
    resolved = {s.stage_code: s for s in sp.cumulative_dues(rows, start_at=START_AT, stage_order=ORDER)}
    assert resolved["upholstery"].due_at is None
    assert resolved["upholstery"].planned_days is None
    assert resolved["cutting"].due_at is not None


def test_skipping_every_stage_is_refused():
    rows = plan(cutting=None, frame_work=None)
    errors = sp.validate_plan(rows, stage_order=ORDER, start_date=START, due_date=None)
    assert any("At least one stage must be planned" in e for e in errors)


def test_a_skipped_stage_carrying_days_is_a_contradiction():
    rows = [PlanRow(stage_code="cutting", planned_days=3, skipped=True)]
    errors = sp.validate_plan(rows, stage_order=ORDER, start_date=START, due_date=None)
    assert any("skipped stage cannot also have days" in e for e in errors)


# ─── Day counts ──────────────────────────────────────────────────────────────
def test_zero_or_missing_days_on_a_live_stage_is_refused():
    for days in (0, None):
        rows = [PlanRow(stage_code="cutting", planned_days=days, skipped=False)]
        errors = sp.validate_plan(rows, stage_order=ORDER, start_date=START, due_date=None)
        assert any("at least 1 day" in e for e in errors), days


def test_every_error_is_reported_at_once():
    """An owner filling in eleven fields sees all the mistakes, not the first one."""
    rows = [
        PlanRow(stage_code="cutting", planned_days=0),
        PlanRow(stage_code="nonsense", planned_days=1),
        PlanRow(stage_code="frame_work", planned_days=1),
        PlanRow(stage_code="frame_work", planned_days=2),
    ]
    errors = sp.validate_plan(rows, stage_order=ORDER, start_date=START, due_date=None)
    assert any("Unknown stage" in e for e in errors)
    assert any("may appear once" in e for e in errors)
    assert any("at least 1 day" in e for e in errors)


# ─── Cumulative due instants ─────────────────────────────────────────────────
def test_due_dates_are_cumulative_not_per_stage():
    """"3 days cutting then 2 days frame work" = frame work due on day 5."""
    rows = plan(cutting=3, frame_work=2)
    resolved = {s.stage_code: s for s in sp.cumulative_dues(rows, start_at=START_AT, stage_order=ORDER)}
    assert resolved["cutting"].due_at.astimezone(IST).date() == date(2026, 8, 7)
    assert resolved["frame_work"].due_at.astimezone(IST).date() == date(2026, 8, 9)


def test_due_instants_land_at_end_of_the_working_day_ist():
    rows = plan(cutting=1)
    stage = sp.cumulative_dues(rows, start_at=START_AT, stage_order=ORDER)[0]
    assert stage.due_at.astimezone(IST).hour == 18


def test_payload_order_cannot_change_what_the_dates_mean():
    forward = plan(cutting=3, frame_work=2)
    shuffled = list(reversed(forward))
    assert sp.cumulative_dues(forward, start_at=START_AT, stage_order=ORDER) == sp.cumulative_dues(
        shuffled, start_at=START_AT, stage_order=ORDER
    )


def test_a_stage_with_no_days_gets_no_deadline_rather_than_today():
    rows = [PlanRow(stage_code="cutting", planned_days=None, skipped=False)]
    assert sp.cumulative_dues(rows, start_at=START_AT, stage_order=ORDER)[0].due_at is None


# ─── Legs stay authoritative ─────────────────────────────────────────────────
def test_a_stage_finishing_after_its_leg_is_due_is_refused():
    rows = plan(cutting=5, frame_work=5)
    leg_dues = {"frame_work": datetime(2026, 8, 8, 18, 0, tzinfo=IST)}
    errors = sp.validate_plan(
        rows, stage_order=ORDER, start_date=START, due_date=START + timedelta(days=30),
        leg_dues=leg_dues, start_at=START_AT,
    )
    assert len(errors) == 1
    assert "frame_work" in errors[0]
    assert "after its workshop is due to hand the goods on" in errors[0]


def test_a_stage_inside_its_leg_is_fine():
    rows = plan(cutting=2, frame_work=1)
    leg_dues = {"frame_work": datetime(2026, 8, 20, 18, 0, tzinfo=IST)}
    assert sp.validate_plan(
        rows, stage_order=ORDER, start_date=START, due_date=START + timedelta(days=30),
        leg_dues=leg_dues, start_at=START_AT,
    ) == []


def test_no_legs_supplied_means_no_leg_rule():
    """A legacy single-workshop allocation has no legs to contradict."""
    rows = plan(cutting=50)
    assert sp.validate_plan(rows, stage_order=ORDER, start_date=START, due_date=None) == []


# ─── Seeding from the admin defaults ─────────────────────────────────────────
def test_seed_uses_default_days_in_stage_order():
    rows = sp.seed_from_defaults(STAGE_DEFS)
    assert [r.stage_code for r in rows] == ORDER
    assert [r.planned_days for r in rows] == [2, 3, None, 4, 1]


def test_seed_skips_stages_the_owner_has_not_costed():
    rows = {r.stage_code: r for r in sp.seed_from_defaults(STAGE_DEFS)}
    assert rows["upholstery"].skipped is True
    assert rows["upholstery"].remind is False
    assert rows["cutting"].skipped is False


def test_seeded_plan_is_valid_when_the_budget_allows_it():
    rows = sp.seed_from_defaults(STAGE_DEFS)
    assert sp.validate_plan(
        rows, stage_order=ORDER, start_date=START, due_date=START + timedelta(days=30)
    ) == []


# ─── Scaling a seeded plan into a tight budget ───────────────────────────────
def test_scale_leaves_a_fitting_plan_alone():
    rows = sp.seed_from_defaults(STAGE_DEFS)
    scaled, was_scaled = sp.scale_to_budget(rows, budget=20)
    assert was_scaled is False
    assert scaled == rows


def test_scale_squeezes_an_overrunning_seed_and_says_so():
    rows = sp.seed_from_defaults(STAGE_DEFS)   # 10 days over 4 live stages
    scaled, was_scaled = sp.scale_to_budget(rows, budget=5)
    assert was_scaled is True
    assert sp.total_days(scaled) <= 5
    # Every live stage keeps at least a day — a zero-day stage is not a stage.
    assert all(r.planned_days >= 1 for r in sp.active_rows(scaled))


def test_scale_preserves_which_stages_are_skipped():
    rows = sp.seed_from_defaults(STAGE_DEFS)
    scaled, _ = sp.scale_to_budget(rows, budget=5)
    assert {r.stage_code for r in scaled if r.skipped} == {"upholstery"}


def test_scale_gives_up_when_the_budget_cannot_cover_one_day_each():
    rows = sp.seed_from_defaults(STAGE_DEFS)   # 4 live stages
    scaled, was_scaled = sp.scale_to_budget(rows, budget=3)
    assert was_scaled is False
    # Unscaled and therefore invalid — validate_plan is what tells the operator.
    errors = sp.validate_plan(
        rows, stage_order=ORDER, start_date=START, due_date=START + timedelta(days=3)
    )
    assert errors


def test_scale_with_no_budget_is_a_no_op():
    rows = sp.seed_from_defaults(STAGE_DEFS)
    assert sp.scale_to_budget(rows, budget=None) == (rows, False)


# ─── Budget arithmetic ───────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "due_offset,expected", [(10, 10), (1, 1), (0, 0), (-3, -3)]
)
def test_budget_days_counts_calendar_days_to_the_deadline(due_offset, expected):
    assert sp.budget_days(start_date=START, due_date=START + timedelta(days=due_offset)) == expected


def test_budget_days_is_none_without_a_deadline():
    assert sp.budget_days(start_date=START, due_date=None) is None
