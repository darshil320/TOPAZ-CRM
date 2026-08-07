"""Order status transition rules — pure."""
from src.services.order_status import CANCELLABLE_FROM, can_transition, requires_reason


def test_legal_forward_path():
    assert can_transition("confirmed", "in_production")
    assert can_transition("in_production", "ready")
    assert can_transition("ready", "delivered")
    assert can_transition("delivered", "installed")
    assert can_transition("installed", "closed")


def test_cancel_allowed_while_the_goods_are_still_ours():
    """Was confirmed-only, which locked cancellation out the moment the first
    production event fired (0024 auto-moves the order to in_production). A customer
    who pulls out mid-build has to be recordable."""
    assert can_transition("confirmed", "cancelled")
    assert can_transition("in_production", "cancelled")
    assert can_transition("ready", "cancelled")


def test_cancel_stops_once_the_goods_have_gone_out():
    """Undoing a delivered sale is a RETURN — goods coming back, a credit note — and
    nothing in this schema models that. Flipping the status would assert the furniture
    is not with the customer when it is."""
    assert not can_transition("delivered", "cancelled")
    assert not can_transition("installed", "cancelled")
    assert not can_transition("closed", "cancelled")


def test_cancellable_from_is_derived_from_the_map():
    """The API gates on CANCELLABLE_FROM and the map gates the transition. If the two
    were maintained separately they would eventually disagree about what is legal."""
    assert CANCELLABLE_FROM == frozenset({"confirmed", "in_production", "ready"})
    for status in CANCELLABLE_FROM:
        assert can_transition(status, "cancelled")


def test_illegal_jumps_and_terminal():
    assert not can_transition("confirmed", "delivered")
    assert not can_transition("ready", "closed")
    assert not can_transition("closed", "in_production")
    assert not can_transition("cancelled", "confirmed")
    assert not can_transition("unknown", "confirmed")


def test_reason_required_only_for_cancel():
    assert requires_reason("cancelled")
    assert not requires_reason("in_production")
    assert not requires_reason("closed")


def test_production_trigger_edges_stay_legal():
    """PIN TEST for the 2B denorm trigger.

    `production_event_apply()` (supabase/migrations/0024_production.sql) auto-flips
    orders.status along exactly two edges. SQL cannot import this map, so if someone
    narrows ALLOWED_TRANSITIONS without touching the trigger, the trigger would
    silently violate it. This test fails first instead.
    """
    assert can_transition("confirmed", "in_production")
    assert can_transition("in_production", "ready")
