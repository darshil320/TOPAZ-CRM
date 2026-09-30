"""Pure date-math for lead follow-up due dates — services/lead_status.py.

No I/O, no DB, no clock dependency at test time: every function accepts an
explicit `today` so tests are deterministic without monkeypatching datetime.
"""
from datetime import date

from src.services import lead_status as ls


class TestDaysUntil:
    def test_future_date_is_positive(self):
        assert ls.days_until(date(2026, 10, 5), today=date(2026, 10, 1)) == 4

    def test_today_is_zero(self):
        assert ls.days_until(date(2026, 10, 1), today=date(2026, 10, 1)) == 0

    def test_past_date_is_negative(self):
        assert ls.days_until(date(2026, 9, 28), today=date(2026, 10, 1)) == -3

    def test_default_today_is_real_today(self):
        # No explicit today: falls back to date.today(). Just prove it runs and
        # returns an int — the exact value is inherently non-deterministic.
        assert isinstance(ls.days_until(date(2026, 1, 1)), int)


class TestIsFollowupOverdue:
    def test_past_due_date_is_overdue(self):
        assert ls.is_followup_overdue(date(2026, 9, 28), today=date(2026, 10, 1)) is True

    def test_today_is_not_overdue(self):
        # Due today is "due today", not "overdue" — distinct UI states.
        assert ls.is_followup_overdue(date(2026, 10, 1), today=date(2026, 10, 1)) is False

    def test_future_date_is_not_overdue(self):
        assert ls.is_followup_overdue(date(2026, 10, 5), today=date(2026, 10, 1)) is False
