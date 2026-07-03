"""WhatsApp 24-hour customer-service window check.

Meta allows free-form business messages only within 24h of the customer's
last inbound message; outside that window only approved templates may be sent.
"""

from datetime import datetime, timedelta, timezone

SERVICE_WINDOW = timedelta(hours=24)


def within_service_window(
    last_inbound_at: datetime | None,
    now: datetime | None = None,
) -> bool:
    """True if a free-form message is allowed (customer wrote within 24h)."""
    if last_inbound_at is None:
        return False
    reference = now or datetime.now(timezone.utc)
    if last_inbound_at.tzinfo is None:
        last_inbound_at = last_inbound_at.replace(tzinfo=timezone.utc)
    return (reference - last_inbound_at) < SERVICE_WINDOW
