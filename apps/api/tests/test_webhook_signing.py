"""Pure tests for services/webhook_signing.py — Standard Webhooks HMAC verification.

No network, no live Supabase call: every signature here is computed by hand in the
test itself (same algorithm the module implements), which is what makes this
verifiable in isolation rather than only against a real webhook delivery.
"""

import base64
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import pytest

from src.services.webhook_signing import (
    WebhookVerificationError,
    verify_standard_webhook,
)

SECRET_KEY_BYTES = b"a" * 32  # arbitrary 32-byte HMAC key for the test
SECRET_B64 = base64.b64encode(SECRET_KEY_BYTES).decode()
SECRET = f"v1,whsec_{SECRET_B64}"

WEBHOOK_ID = "msg_2abc123"
BODY = b'{"user":{"phone":"+919426529230"},"sms":{"otp":"482913"}}'


def _sign(webhook_id: str, timestamp: str, body: bytes, key_bytes: bytes = SECRET_KEY_BYTES) -> str:
    """Reference implementation, deliberately re-derived here rather than imported
    from the module under test — a bug shared by both would go undetected otherwise."""
    signed_content = f"{webhook_id}.{timestamp}.".encode() + body
    digest = hmac.new(key_bytes, signed_content, hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def _fresh_timestamp(now: datetime | None = None) -> str:
    return str(int((now or datetime.now(timezone.utc)).timestamp()))


def test_valid_signature_passes():
    ts = _fresh_timestamp()
    sig = _sign(WEBHOOK_ID, ts, BODY)
    verify_standard_webhook(
        secret=SECRET, webhook_id=WEBHOOK_ID, webhook_timestamp=ts, body=BODY,
        signature_header=f"v1,{sig}",
    )  # raises on failure — reaching here is the assertion


def test_secret_without_v1_prefix_also_works():
    """Supabase's display format is `v1,whsec_...`; a bare `whsec_...` (a future
    format change, or a value copied without the prefix) must still verify."""
    bare_secret = f"whsec_{SECRET_B64}"
    ts = _fresh_timestamp()
    sig = _sign(WEBHOOK_ID, ts, BODY)
    verify_standard_webhook(
        secret=bare_secret, webhook_id=WEBHOOK_ID, webhook_timestamp=ts, body=BODY,
        signature_header=f"v1,{sig}",
    )


def test_wrong_secret_is_rejected():
    ts = _fresh_timestamp()
    sig = _sign(WEBHOOK_ID, ts, BODY, key_bytes=b"b" * 32)  # signed with a DIFFERENT key
    with pytest.raises(WebhookVerificationError):
        verify_standard_webhook(
            secret=SECRET, webhook_id=WEBHOOK_ID, webhook_timestamp=ts, body=BODY,
            signature_header=f"v1,{sig}",
        )


def test_tampered_body_is_rejected():
    ts = _fresh_timestamp()
    sig = _sign(WEBHOOK_ID, ts, BODY)  # signed over the ORIGINAL body
    tampered = BODY.replace(b"482913", b"999999")
    with pytest.raises(WebhookVerificationError):
        verify_standard_webhook(
            secret=SECRET, webhook_id=WEBHOOK_ID, webhook_timestamp=ts, body=tampered,
            signature_header=f"v1,{sig}",
        )


def test_wrong_webhook_id_is_rejected():
    ts = _fresh_timestamp()
    sig = _sign(WEBHOOK_ID, ts, BODY)
    with pytest.raises(WebhookVerificationError):
        verify_standard_webhook(
            secret=SECRET, webhook_id="msg_different", webhook_timestamp=ts, body=BODY,
            signature_header=f"v1,{sig}",
        )


def test_stale_timestamp_is_rejected():
    old = datetime.now(timezone.utc) - timedelta(hours=2)
    ts = _fresh_timestamp(old)
    sig = _sign(WEBHOOK_ID, ts, BODY)
    with pytest.raises(WebhookVerificationError, match="outside the"):
        verify_standard_webhook(
            secret=SECRET, webhook_id=WEBHOOK_ID, webhook_timestamp=ts, body=BODY,
            signature_header=f"v1,{sig}",
        )


def test_future_timestamp_is_also_rejected_not_just_past():
    future = datetime.now(timezone.utc) + timedelta(hours=2)
    ts = _fresh_timestamp(future)
    sig = _sign(WEBHOOK_ID, ts, BODY)
    with pytest.raises(WebhookVerificationError, match="outside the"):
        verify_standard_webhook(
            secret=SECRET, webhook_id=WEBHOOK_ID, webhook_timestamp=ts, body=BODY,
            signature_header=f"v1,{sig}",
        )


def test_non_integer_timestamp_is_rejected_not_a_crash():
    sig = _sign(WEBHOOK_ID, "not-a-number", BODY)
    with pytest.raises(WebhookVerificationError, match="not a valid integer"):
        verify_standard_webhook(
            secret=SECRET, webhook_id=WEBHOOK_ID, webhook_timestamp="not-a-number", body=BODY,
            signature_header=f"v1,{sig}",
        )


@pytest.mark.parametrize("missing_field", ["webhook_id", "webhook_timestamp", "signature_header"])
def test_missing_header_fails_closed(missing_field):
    ts = _fresh_timestamp()
    sig = _sign(WEBHOOK_ID, ts, BODY)
    kwargs = {
        "secret": SECRET, "webhook_id": WEBHOOK_ID, "webhook_timestamp": ts,
        "body": BODY, "signature_header": f"v1,{sig}",
    }
    kwargs[missing_field] = ""
    with pytest.raises(WebhookVerificationError):
        verify_standard_webhook(**kwargs)


def test_rotation_supports_multiple_candidate_signatures_in_one_header():
    """Supabase may send more than one 'v1,<sig>' candidate during a secret rotation
    window — a match against ANY of them is a pass."""
    ts = _fresh_timestamp()
    real_sig = _sign(WEBHOOK_ID, ts, BODY)
    decoy_sig = _sign(WEBHOOK_ID, ts, BODY, key_bytes=b"c" * 32)
    verify_standard_webhook(
        secret=SECRET, webhook_id=WEBHOOK_ID, webhook_timestamp=ts, body=BODY,
        signature_header=f"v1,{decoy_sig} v1,{real_sig}",
    )


def test_one_bit_flip_in_signature_is_rejected():
    """Sanity check that comparison is exact, not just 'looks similar'."""
    ts = _fresh_timestamp()
    sig = _sign(WEBHOOK_ID, ts, BODY)
    flipped = sig[:-1] + ("A" if sig[-1] != "A" else "B")
    with pytest.raises(WebhookVerificationError):
        verify_standard_webhook(
            secret=SECRET, webhook_id=WEBHOOK_ID, webhook_timestamp=ts, body=BODY,
            signature_header=f"v1,{flipped}",
        )
