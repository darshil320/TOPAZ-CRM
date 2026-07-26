"""Pure tests for services/stage_flow.py — stage ordering + the lead/sub capability
split. No DB, no ML deps: this file must pass on a bare `pip install pytest`.
"""

import pytest

from src.services import stage_flow as sf

# A trimmed stand-in for production_stage_defs (0024): sort in tens, deliberately
# NOT contiguous, so nothing under test may assume sort == index.
ROWS = [
    {"code": "design_approved", "sort": 10, "photo_required": False},
    {"code": "cutting", "sort": 30, "photo_required": False},
    {"code": "frame_work", "sort": 40, "photo_required": True},
    {"code": "polishing", "sort": 70, "photo_required": False},
    {"code": "finishing", "sort": 80, "photo_required": True},
    {"code": "dispatch", "sort": 110, "photo_required": True},
]


@pytest.fixture
def stages():
    return sf.to_stages(ROWS)


def test_to_stages_sorts_by_sort_not_input_order():
    shuffled = sf.to_stages(list(reversed(ROWS)))
    assert [s.code for s in shuffled] == [r["code"] for r in ROWS]


def test_first_and_last(stages):
    assert sf.first_code(stages) == "design_approved"
    assert sf.last_code(stages) == "dispatch"


def test_next_code_walks_the_whole_chain(stages):
    walked = ["design_approved"]
    while (nxt := sf.next_code(stages, walked[-1])) is not None:
        walked.append(nxt)
    assert walked == [r["code"] for r in ROWS]


def test_next_code_of_last_is_none(stages):
    assert sf.next_code(stages, "dispatch") is None


def test_next_code_of_unknown_is_none(stages):
    assert sf.next_code(stages, "sanding") is None


def test_codes_in_span_is_inclusive(stages):
    assert sf.codes_in_span(stages, "cutting", "polishing") == (
        "cutting", "frame_work", "polishing",
    )


def test_codes_in_span_single_stage(stages):
    assert sf.codes_in_span(stages, "polishing", "polishing") == ("polishing",)


def test_codes_in_span_backwards_is_empty(stages):
    assert sf.codes_in_span(stages, "finishing", "cutting") == ()


def test_is_within_span_is_the_routing_guard(stages):
    # Workshop A owns cutting→polishing. It may tick frame_work…
    assert sf.is_within_span(stages, "frame_work", "cutting", "polishing")
    # …and must NOT be able to tick workshop B's finishing.
    assert not sf.is_within_span(stages, "finishing", "cutting", "polishing")
    # Nor a stage that already happened at somebody else's site.
    assert not sf.is_within_span(stages, "design_approved", "cutting", "polishing")


def test_skipped_codes_is_half_open_and_ascending(stages):
    # An override from cutting to finishing must insert `done` for cutting,
    # frame_work and polishing — NOT for finishing itself (the caller inserts that).
    assert sf.skipped_codes(stages, "cutting", "finishing") == (
        "cutting", "frame_work", "polishing",
    )


def test_skipped_codes_refuses_to_go_backwards(stages):
    assert sf.skipped_codes(stages, "finishing", "cutting") == ()
    assert sf.skipped_codes(stages, "cutting", "cutting") == ()


def test_photo_required_lookup(stages):
    assert sf.photo_required_for(stages, "frame_work") is True
    assert sf.photo_required_for(stages, "polishing") is False
    assert sf.photo_required_for(stages, "nonexistent") is False


# ─── Capabilities (module 14 D4) ─────────────────────────────────────────────
def test_sub_manager_may_update_status_but_never_move_custody():
    caps = sf.capabilities_for(role="workshop_manager", staff_role=sf.STAFF_SUB)
    assert caps == frozenset({sf.CAP_STATUS})
    assert not sf.has_capability(sf.CAP_CUSTODY, role="workshop_manager", staff_role=sf.STAFF_SUB)


def test_lead_may_do_both():
    caps = sf.capabilities_for(role="workshop_manager", staff_role=sf.STAFF_LEAD)
    assert caps == frozenset({sf.CAP_STATUS, sf.CAP_CUSTODY})


def test_workshop_manager_not_on_this_roster_may_do_nothing_here():
    assert sf.capabilities_for(role="workshop_manager", staff_role=None) == frozenset()


def test_owner_and_admin_are_the_escape_hatch():
    for role in ("owner", "admin"):
        caps = sf.capabilities_for(role=role, staff_role=None)
        assert {sf.CAP_STATUS, sf.CAP_CUSTODY, sf.CAP_TRANSIT, sf.CAP_ALLOCATE} <= caps


def test_courier_moves_goods_but_never_production_state():
    caps = sf.capabilities_for(role="delivery", staff_role=None)
    assert caps == frozenset({sf.CAP_TRANSIT})
    assert sf.CAP_STATUS not in caps


def test_salesperson_plans_production_but_does_not_execute_it():
    caps = sf.capabilities_for(role="salesperson", staff_role=None)
    assert caps == frozenset({sf.CAP_ALLOCATE})


def test_accounts_has_no_production_capability_at_all():
    assert sf.capabilities_for(role="accounts", staff_role=sf.STAFF_LEAD) == frozenset()
