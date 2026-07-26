"""Order status transition rules — pure."""
from src.services.order_status import can_transition, requires_reason


def test_legal_forward_path():
    assert can_transition("confirmed", "in_production")
    assert can_transition("in_production", "ready")
    assert can_transition("ready", "delivered")
    assert can_transition("delivered", "installed")
    assert can_transition("installed", "closed")


def test_cancel_only_from_confirmed():
    assert can_transition("confirmed", "cancelled")
    assert not can_transition("in_production", "cancelled")
    assert not can_transition("ready", "cancelled")


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
