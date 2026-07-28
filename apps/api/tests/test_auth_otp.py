"""Pure tests for services/auth_otp.py — the Meta Authentication-template param
builder. No DB, no network.
"""

import pytest

from src.services.auth_otp import InvalidOtpError, otp_params


def test_valid_six_digit_code():
    assert otp_params("482913") == [{"type": "text", "text": "482913"}]


def test_no_parameter_name_key_present():
    """Positional, not named — the one deliberate difference from every other
    template send in this codebase (see the module docstring for why)."""
    params = otp_params("000000")
    assert "parameter_name" not in params[0]


@pytest.mark.parametrize("bad", ["12345", "1234567", "", "12345a", "12 345", "-12345"])
def test_non_six_digit_or_non_numeric_is_rejected(bad):
    with pytest.raises(InvalidOtpError):
        otp_params(bad)


def test_leading_zero_is_preserved_not_treated_as_a_number():
    """'0' is a valid digit; the code is a string identity, never cast to int
    (which would silently drop a leading zero and send the wrong code)."""
    assert otp_params("012345") == [{"type": "text", "text": "012345"}]
