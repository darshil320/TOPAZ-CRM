"""Pure parsers for Meta WhatsApp webhook payloads.

Separated from the FastAPI route so payload extraction is unit-testable and
the route stays a thin dispatch layer. Meta payload reference:
entry[].changes[].value.{messages[], statuses[]}.
"""

from dataclasses import dataclass
from datetime import datetime, timezone

# messages.status CHECK constraint values we accept from Meta status events.
_ALLOWED_STATUSES = {"sent", "delivered", "read", "failed"}


@dataclass(frozen=True)
class InboundTextMessage:
    wa_id: str
    wamid: str
    text: str
    received_at: str  # ISO 8601 UTC


@dataclass(frozen=True)
class StatusUpdate:
    wamid: str
    status: str


def _iter_change_values(payload: dict) -> list[dict]:
    values = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value")
            if isinstance(value, dict):
                values.append(value)
    return values


def parse_inbound_texts(payload: dict) -> list[InboundTextMessage]:
    """Extract inbound text messages; non-text types are ignored."""
    messages: list[InboundTextMessage] = []
    for value in _iter_change_values(payload):
        for msg in value.get("messages", []):
            if msg.get("type") != "text":
                continue
            wa_id = msg.get("from", "")
            wamid = msg.get("id", "")
            text_body = msg.get("text", {}).get("body", "")
            if not (wa_id and wamid and text_body):
                continue
            ts = int(msg.get("timestamp", 0))
            received_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            messages.append(
                InboundTextMessage(wa_id=wa_id, wamid=wamid, text=text_body, received_at=received_at)
            )
    return messages


def parse_status_updates(payload: dict) -> list[StatusUpdate]:
    """Extract delivery-status events (sent/delivered/read/failed) keyed by wamid."""
    updates: list[StatusUpdate] = []
    for value in _iter_change_values(payload):
        for st in value.get("statuses", []):
            wamid = st.get("id", "")
            status = st.get("status", "")
            if wamid and status in _ALLOWED_STATUSES:
                updates.append(StatusUpdate(wamid=wamid, status=status))
    return updates
