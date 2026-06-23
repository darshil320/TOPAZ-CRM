"""Unit tests for owner-alert message builders."""

from src.notify import messages


def test_new_customer_message_mentions_showroom_and_photo():
    msg = messages.new_customer_message("12 Jun 2026, 02:05 PM", showroom="Topaz")
    assert "New customer visited at Topaz" in msg
    assert "Photo attached" in msg
    assert "12 Jun 2026, 02:05 PM" in msg


def test_repeat_customer_message_has_name_interest_salesperson():
    msg = messages.repeat_customer_message(
        "Hemant", "7-seater sofa", "12 Jun 2026, 02:05 PM", salesperson="Rahul"
    )
    assert "Hemant" in msg
    assert "7-seater sofa" in msg
    assert "Rahul" in msg


def test_repeat_customer_message_without_salesperson_omits_handled_by():
    msg = messages.repeat_customer_message("Hemant", "dining set", "now")
    assert "Hemant" in msg
    assert "dining set" in msg
    assert "Handled by" not in msg
