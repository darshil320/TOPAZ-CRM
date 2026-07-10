"""Unit tests for LinkSalespersonRequest validation (no DB required)."""
import pytest
from pydantic import ValidationError

from topaz_shared import LinkSalespersonRequest

VALID_UID = "a0000000-0000-0000-0000-000000000002"


def test_accepts_valid_payload():
    req = LinkSalespersonRequest(auth_uid=VALID_UID, phone="+919426529230")
    assert str(req.auth_uid) == VALID_UID
    assert req.phone == "+919426529230"


def test_rejects_empty_phone():
    with pytest.raises(ValidationError):
        LinkSalespersonRequest(auth_uid=VALID_UID, phone="")


def test_rejects_blank_phone():
    with pytest.raises(ValidationError):
        LinkSalespersonRequest(auth_uid=VALID_UID, phone="   ")


def test_rejects_malformed_auth_uid():
    with pytest.raises(ValidationError):
        LinkSalespersonRequest(auth_uid="not-a-uuid", phone="+919426529230")
