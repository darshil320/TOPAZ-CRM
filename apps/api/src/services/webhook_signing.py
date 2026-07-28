"""Standard Webhooks signature verification (svix.com's open spec).

Supabase Auth Hooks (Send SMS, Send Email, etc.) sign every call using this spec —
same shape as Meta's `X-Hub-Signature-256` on the WhatsApp webhook (`api/whatsapp.py`),
hand-rolled here for the identical reason: a small, stable, precisely-specified HMAC
check is safer to own directly than to trust an unverified dependency's exact API
surface for something this security-sensitive, and it needs zero network access to
unit-test.

Spec (https://www.standardwebhooks.com/):
  headers: `webhook-id`, `webhook-timestamp`, `webhook-signature`
  signed content: "{id}.{timestamp}.{raw body bytes}"
  signature: base64(HMAC-SHA256(secret_bytes, signed_content))
  header value: space-separated "v1,<base64sig>" candidates (secret rotation support
  means more than one may be present; a match against ANY is a pass)

Supabase presents the secret as a single string like `v1,whsec_XXXXXXXX` — the `v1,`
part is Supabase's own display convention, not part of the Svix secret; the real key
material is the base64 payload after `whsec_`.
"""

import base64
import hashlib
import hmac
from datetime import datetime, timezone

# Reject a signature whose timestamp has drifted this far from now, either direction —
# the spec's own replay-protection recommendation. Wide enough for real clock skew and
# network latency, narrow enough that a captured request can't be replayed hours later.
_TOLERANCE_SECONDS = 300


class WebhookVerificationError(ValueError):
    """The signature does not verify. Message is safe to log, never to echo to the
    caller — it must not help an attacker narrow down why a forged request failed."""


def _decode_secret(secret: str) -> bytes:
    """Extract the raw HMAC key from Supabase's `v1,whsec_...` display format (or a
    bare `whsec_...`, in case a future Supabase version drops the prefix)."""
    key_part = secret.split(",")[-1]  # drop a leading "v1," if present
    if key_part.startswith("whsec_"):
        key_part = key_part[len("whsec_"):]
    return base64.b64decode(key_part)


def _candidate_signatures(header_value: str) -> list[str]:
    """`"v1,AAA v1,BBB"` -> `["AAA", "BBB"]` — multiple candidates support secret
    rotation (Supabase may sign with both the old and new secret during a rotation
    window); a match against any one is sufficient."""
    candidates = []
    for token in header_value.split():
        if "," in token:
            _version, sig = token.split(",", 1)
            candidates.append(sig)
        else:
            candidates.append(token)
    return candidates


def verify_standard_webhook(
    *,
    secret: str,
    webhook_id: str,
    webhook_timestamp: str,
    body: bytes,
    signature_header: str,
    now: datetime | None = None,
) -> None:
    """Raise WebhookVerificationError unless `signature_header` is a valid Standard
    Webhooks signature over `body` for this `webhook_id`/`webhook_timestamp`.

    Every argument is required and unvalidated by the caller on purpose: a missing
    header must fail closed here, not be silently treated as "no signature to check".
    """
    if not webhook_id or not webhook_timestamp or not signature_header:
        raise WebhookVerificationError("missing webhook-id/webhook-timestamp/webhook-signature header")

    try:
        ts = int(webhook_timestamp)
    except ValueError as exc:
        raise WebhookVerificationError("webhook-timestamp is not a valid integer") from exc

    reference = now or datetime.now(timezone.utc)
    age_seconds = abs(reference.timestamp() - ts)
    if age_seconds > _TOLERANCE_SECONDS:
        raise WebhookVerificationError(
            f"webhook-timestamp is {age_seconds:.0f}s from now, outside the "
            f"{_TOLERANCE_SECONDS}s tolerance (stale or replayed request)"
        )

    key = _decode_secret(secret)
    signed_content = f"{webhook_id}.{webhook_timestamp}.".encode() + body
    expected = base64.b64encode(hmac.new(key, signed_content, hashlib.sha256).digest()).decode()

    candidates = _candidate_signatures(signature_header)
    if not any(hmac.compare_digest(expected, candidate) for candidate in candidates):
        raise WebhookVerificationError("signature does not match any candidate")
