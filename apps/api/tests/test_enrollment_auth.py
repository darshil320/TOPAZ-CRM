"""Unit tests for the enrollment API-Key check (no DB required).

Regression for the kiosk 401 bug: the dashboard kiosk sends DASHBOARD_API_KEY
but POST /api/enrollment only accepted EDGE_API_KEY, so every kiosk
registration failed with "Invalid API key".
"""
import pytest
from fastapi import HTTPException

from src.api.enrollment import verify_api_key

EDGE_KEY = "edge-key-0123456789abcdef0123456789abcdef"
DASH_KEY = "dash-key-0123456789abcdef0123456789abcdef"


def test_accepts_first_key():
    verify_api_key(EDGE_KEY, (EDGE_KEY, DASH_KEY))


def test_accepts_second_key():
    """Kiosk regression: dashboard key must open POST /enrollment."""
    verify_api_key(DASH_KEY, (EDGE_KEY, DASH_KEY))


def test_rejects_unknown_key():
    with pytest.raises(HTTPException) as exc:
        verify_api_key("wrong-key", (EDGE_KEY, DASH_KEY))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid API key"


def test_rejects_empty_provided_key():
    with pytest.raises(HTTPException):
        verify_api_key("", (EDGE_KEY, DASH_KEY))


def test_skips_unset_keys():
    """DASHBOARD_API_KEY may be None in dev — must not match anything."""
    with pytest.raises(HTTPException):
        verify_api_key("", (EDGE_KEY, None))
    verify_api_key(EDGE_KEY, (EDGE_KEY, None))


def test_rejects_when_no_keys_configured():
    with pytest.raises(HTTPException):
        verify_api_key(EDGE_KEY, (None, None))
