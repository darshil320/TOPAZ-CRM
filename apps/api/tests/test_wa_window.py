"""Unit tests for the WhatsApp 24h service-window check (no DB required)."""
from datetime import datetime, timedelta, timezone

from src.services.wa_window import within_service_window

NOW = datetime(2026, 7, 3, 12, 0, 0, tzinfo=timezone.utc)


def test_no_inbound_ever_means_closed():
    assert within_service_window(None, NOW) is False


def test_inbound_one_hour_ago_is_open():
    assert within_service_window(NOW - timedelta(hours=1), NOW) is True


def test_inbound_just_under_24h_is_open():
    assert within_service_window(NOW - timedelta(hours=23, minutes=59), NOW) is True


def test_inbound_exactly_24h_is_closed():
    assert within_service_window(NOW - timedelta(hours=24), NOW) is False


def test_inbound_days_ago_is_closed():
    assert within_service_window(NOW - timedelta(days=3), NOW) is False


def test_naive_datetime_treated_as_utc():
    naive = (NOW - timedelta(hours=2)).replace(tzinfo=None)
    assert within_service_window(naive, NOW) is True
