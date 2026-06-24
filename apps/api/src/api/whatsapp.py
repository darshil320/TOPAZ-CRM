"""WhatsApp Cloud API integration — webhook receiver + outbound send endpoint.

GET  /api/whatsapp/webhook  — Meta's hub.verify challenge (webhook registration)
POST /api/whatsapp/webhook  — Inbound message events from Meta
POST /api/whatsapp/send     — Dashboard → send approved message to customer
                              (§19-G: service-role write goes through FastAPI, not browser)

Inbound security: Meta signs webhook POSTs with X-Hub-Signature-256.
Outbound auth: DASHBOARD_API_KEY header (pre-shared, server-to-server only).
"""

import hashlib
import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, field_validator

from ..config import get_settings
from ..tasks.ai import handle_inbound_reply
from ..tasks.whatsapp import send_customer_message

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/whatsapp")


# ─── webhook verification (GET) ───────────────────────────────────────────────

@router.get("/webhook")
async def verify_webhook(
    hub_mode: str = Query(alias="hub.mode"),
    hub_challenge: str = Query(alias="hub.challenge"),
    hub_verify_token: str = Query(alias="hub.verify_token"),
) -> int:
    settings = get_settings()
    if not settings.WA_WEBHOOK_VERIFY_TOKEN:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Webhook not configured")
    if hub_mode != "subscribe" or hub_verify_token != settings.WA_WEBHOOK_VERIFY_TOKEN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verification failed")
    return int(hub_challenge)


# ─── inbound webhook (POST) ───────────────────────────────────────────────────

def _verify_meta_signature(body: bytes, signature_header: str | None) -> None:
    """Constant-time HMAC-SHA256 check of Meta's X-Hub-Signature-256 header."""
    settings = get_settings()
    if not settings.WA_TOKEN:
        return  # skip sig check if WA not configured (dev mode)
    if not signature_header or not signature_header.startswith("sha256="):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing signature")
    expected = hmac.new(settings.WA_TOKEN.encode(), body, hashlib.sha256).hexdigest()
    provided = signature_header.removeprefix("sha256=")
    if not hmac.compare_digest(expected, provided):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def receive_webhook(
    request: Request,
    x_hub_signature_256: str | None = Header(default=None, alias="X-Hub-Signature-256"),
) -> dict:
    body = await request.body()
    _verify_meta_signature(body, x_hub_signature_256)

    payload = await request.json()
    try:
        _dispatch_inbound(payload)
    except Exception:
        logger.exception("Error dispatching webhook payload")
    # Always return 200 — Meta retries on any non-200.
    return {"status": "ok"}


def _dispatch_inbound(payload: dict) -> None:
    """Extract text messages from the webhook payload and enqueue tasks."""
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for msg in value.get("messages", []):
                if msg.get("type") != "text":
                    continue
                wa_id: str = msg.get("from", "")
                wamid: str = msg.get("id", "")
                text_body: str = msg.get("text", {}).get("body", "")
                ts: int = int(msg.get("timestamp", 0))
                received_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

                if wa_id and wamid and text_body:
                    handle_inbound_reply.delay(wa_id, text_body, wamid, received_at)
                    logger.info("Queued inbound: wa_id=%s wamid=%s", wa_id, wamid)


# ─── outbound send (POST) ─────────────────────────────────────────────────────

class SendRequest(BaseModel):
    wa_id: str
    content: str
    message_id: str  # messages.id — caller updates status on success

    @field_validator("content")
    @classmethod
    def content_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("content must not be blank")
        return v

    @field_validator("wa_id")
    @classmethod
    def wa_id_digits_only(cls, v: str) -> str:
        clean = v.lstrip("+")
        if not clean.isdigit() or len(clean) < 10:
            raise ValueError("wa_id must be a numeric phone number")
        return clean


def _verify_dashboard_key(provided: str) -> None:
    settings = get_settings()
    if not settings.DASHBOARD_API_KEY:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Send not configured")
    expected = settings.DASHBOARD_API_KEY.encode()
    if not hmac.compare_digest(expected, provided.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


@router.post("/send", status_code=status.HTTP_202_ACCEPTED)
async def send_message(
    req: SendRequest,
    api_key: str = Header(alias="API-Key"),
) -> dict:
    """Enqueue a WhatsApp message to a customer.

    Called exclusively from Next.js server actions (DASHBOARD_API_KEY in env).
    The key is never exposed to the browser — §19-G.
    """
    _verify_dashboard_key(api_key)
    send_customer_message.delay(req.wa_id, req.content, req.message_id)
    return {"message_id": req.message_id, "queued": True}
