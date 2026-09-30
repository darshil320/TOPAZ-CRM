"""Pure-logic tests for lead status transitions and phone matching."""

import pytest

from src.services import lead_status as ls


class TestTransitions:
    @pytest.mark.parametrize(
        "frm,to",
        [
            ("new", "contacted"),
            ("new", "qualified"),
            ("new", "lost"),
            ("contacted", "qualified"),
            ("contacted", "lost"),
            ("qualified", "converted"),
            ("qualified", "lost"),
        ],
    )
    def test_legal_moves(self, frm, to):
        assert ls.can_transition(frm, to)

    @pytest.mark.parametrize(
        "frm,to",
        [
            # Conversion must pass through 'qualified' — this is the whole point of
            # having that state.
            ("new", "converted"),
            ("contacted", "converted"),
            # Terminal states are terminal.
            ("converted", "contacted"),
            ("converted", "lost"),
            ("lost", "new"),
            ("lost", "qualified"),
            # No going backwards.
            ("qualified", "new"),
            ("contacted", "new"),
        ],
    )
    def test_illegal_moves(self, frm, to):
        assert not ls.can_transition(frm, to)

    def test_unknown_status_is_not_a_crash(self):
        assert not ls.can_transition("banana", "new")
        assert not ls.can_transition("new", "banana")

    def test_convertible_from_matches_the_map(self):
        # Derived, not written twice — guard against the two drifting.
        assert ls.CONVERTIBLE_FROM == frozenset({"qualified"})


class TestReason:
    def test_lost_requires_reason(self):
        assert ls.requires_reason("lost")

    @pytest.mark.parametrize("status", ["new", "contacted", "qualified", "converted"])
    def test_others_do_not(self, status):
        assert not ls.requires_reason(status)


class TestPhoneNormalisation:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("+91 94265 29230", "919426529230"),
            ("9426529230", "9426529230"),
            ("+919426529230", "919426529230"),
            ("094265-29230", "09426529230"),
            ("", ""),
            (None, ""),
        ],
    )
    def test_digits_only(self, raw, expected):
        assert ls.normalise_phone_digits(raw) == expected


class TestPhoneMatchKey:
    def test_country_code_variants_match(self):
        # The case the dedupe exists for: same person, three ways of typing it.
        keys = {
            ls.phone_match_key("+91 94265 29230"),
            ls.phone_match_key("9426529230"),
            ls.phone_match_key("919426529230"),  # wa_id form, no plus
        }
        assert len(keys) == 1
        assert keys.pop() == "9426529230"

    def test_different_numbers_do_not_match(self):
        assert ls.phone_match_key("9426529230") != ls.phone_match_key("9426529231")

    def test_short_number_is_not_padded_or_truncated(self):
        assert ls.phone_match_key("12345") == "12345"
