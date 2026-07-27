"""Pure tests for services/transit_messages.py — the named-param builders for the
three Meta templates (topaz_transfer_incoming / topaz_transfer_status /
topaz_production_alert). No DB, no network, no ML deps.
"""

from datetime import datetime, timedelta, timezone

from src.services import transit_messages as tm

IST = tm.IST


def test_format_ist_renders_the_same_string_a_workshop_card_would():
    moment = datetime(2026, 8, 1, 12, 30, tzinfo=timezone.utc)  # 18:00 IST
    assert tm.format_ist(moment) == "Sat 01 Aug, 6:00 PM"


def test_format_ist_none_is_the_filler_not_a_blank_or_none_string():
    assert tm.format_ist(None) == "—"


def test_format_ist_naive_datetime_is_read_as_utc():
    naive = datetime(2026, 8, 1, 12, 30)
    aware = datetime(2026, 8, 1, 12, 30, tzinfo=timezone.utc)
    assert tm.format_ist(naive) == tm.format_ist(aware)


def test_overdue_by_none_is_the_filler():
    assert tm.overdue_by(None) == "—"


def test_overdue_by_days():
    due = datetime.now(timezone.utc) - timedelta(days=3, hours=2)
    assert tm.overdue_by(due) == "3 days late"


def test_overdue_by_singular_day():
    due = datetime.now(timezone.utc) - timedelta(days=1, hours=1)
    assert tm.overdue_by(due) == "1 day late"


def test_overdue_by_hours_under_a_day():
    due = datetime.now(timezone.utc) - timedelta(hours=5)
    assert tm.overdue_by(due) == "5 hours late"


def test_overdue_by_not_yet_due_reads_as_such_not_negative_hours():
    due = datetime.now(timezone.utc) + timedelta(hours=3)
    assert tm.overdue_by(due) == "not yet due"


def test_overdue_by_due_now_for_sub_hour_lateness():
    due = datetime.now(timezone.utc) - timedelta(minutes=10)
    assert tm.overdue_by(due) == "due now"


# ─── transfer_incoming_params ────────────────────────────────────────────────
def test_transfer_incoming_params_shape_and_names():
    due = datetime(2026, 8, 1, 12, 30, tzinfo=timezone.utc)
    params = tm.transfer_incoming_params(
        transfer_no="TRF-2627-0001", from_workshop="Topaz Main floor",
        to_workshop="Topaz Side Quests", item_count=2, due_at=due,
    )
    by_name = {p["parameter_name"]: p["text"] for p in params}
    assert by_name["transfer_no"] == "TRF-2627-0001"
    assert by_name["from_workshop"] == "Topaz Main floor"
    assert by_name["to_workshop"] == "Topaz Side Quests"
    assert by_name["item_count"] == "2"
    assert by_name["due_at"] == "Sat 01 Aug, 6:00 PM"
    assert all(p["type"] == "text" for p in params)


def test_transfer_incoming_params_missing_due_at_is_the_filler_not_none_string():
    params = tm.transfer_incoming_params(
        transfer_no="TRF-2627-0002", from_workshop="A", to_workshop="B",
        item_count=1, due_at=None,
    )
    by_name = {p["parameter_name"]: p["text"] for p in params}
    assert by_name["due_at"] == "—"


# ─── transfer_status_params ──────────────────────────────────────────────────
def test_transfer_status_params_shape():
    params = tm.transfer_status_params(
        transfer_no="TRF-2627-0001", status_text="Delivered",
        workshop_name="Topaz Side Quests", note="Driver: Ramesh",
    )
    by_name = {p["parameter_name"]: p["text"] for p in params}
    assert by_name == {
        "transfer_no": "TRF-2627-0001",
        "status_text": "Delivered",
        "workshop_name": "Topaz Side Quests",
        "note": "Driver: Ramesh",
    }


def test_transfer_status_params_note_defaults_to_filler_never_blank():
    params = tm.transfer_status_params(
        transfer_no="TRF-2627-0003", status_text="Picked up",
        workshop_name="Topaz Main floor", note=None,
    )
    by_name = {p["parameter_name"]: p["text"] for p in params}
    assert by_name["note"] == "—"
    # No approved-template param may ever render an actually-empty string — that
    # would surface as a blank line inside the fixed wording Meta approved.
    assert all(p["text"] != "" for p in params)


# ─── production_alert_params ─────────────────────────────────────────────────
def test_production_alert_params_shape():
    params = tm.production_alert_params(
        order_no="ORD-2627-0005", item_description="L shape italian sofa",
        workshop_name="Topaz Main floor", issue="3 days late",
        detail="Was due Sat 01 Aug, 6:00 PM",
    )
    by_name = {p["parameter_name"]: p["text"] for p in params}
    assert by_name == {
        "order_no": "ORD-2627-0005",
        "item_description": "L shape italian sofa",
        "workshop_name": "Topaz Main floor",
        "issue": "3 days late",
        "detail": "Was due Sat 01 Aug, 6:00 PM",
    }


def test_production_alert_params_detail_defaults_to_filler():
    params = tm.production_alert_params(
        order_no="ORD-2627-0004", item_description="4 leather chair",
        workshop_name="Topaz Side Quests", issue="Blocked", detail=None,
    )
    by_name = {p["parameter_name"]: p["text"] for p in params}
    assert by_name["detail"] == "—"


def test_no_params_are_ever_the_empty_string_across_all_three_builders():
    """The one invariant every builder must uphold: a falsy value becomes the
    filler, never '' — an approved template cannot render a conditional blank."""
    all_params = [
        *tm.transfer_incoming_params(
            transfer_no="", from_workshop="", to_workshop="", item_count=0, due_at=None,
        ),
        *tm.transfer_status_params(
            transfer_no="", status_text="", workshop_name="", note="",
        ),
        *tm.production_alert_params(
            order_no="", item_description="", workshop_name="", issue="", detail="",
        ),
    ]
    assert all(p["text"] == "—" for p in all_params)
