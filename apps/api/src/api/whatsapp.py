"""WhatsApp Cloud API integration — webhook receiver + outbound send endpoint.

GET  /api/whatsapp/webhook  — Meta's hub.verify challenge (webhook registration)
POST /api/whatsapp/webhook  — Inbound messages + delivery statuses from Meta
POST /api/whatsapp/send     — Dashboard → send approved message to customer
                              (§19-G: service-role write goes through FastAPI, not browser)

Inbound security: Meta signs webhook POSTs with X-Hub-Signature-256 using the
App Secret (WA_APP_SECRET) — NOT the access token.
Outbound auth: DASHBOARD_API_KEY header (pre-shared, server-to-server only).
"""

import hashlib
import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, field_validator

from ..config import get_settings
from ..database import make_task_session
from ..repositories.message_repo import update_status_by_wamid
from ..services.wa_webhook import parse_inbound_texts, parse_status_updates
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
) -> PlainTextResponse:
    settings = get_settings()
    if not settings.WA_WEBHOOK_VERIFY_TOKEN:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Webhook not configured")
    token_ok = hmac.compare_digest(
        hub_verify_token.encode(), settings.WA_WEBHOOK_VERIFY_TOKEN.encode()
    )
    if hub_mode != "subscribe" or not token_ok:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verification failed")
    return PlainTextResponse(hub_challenge)


# ─── inbound webhook (POST) ───────────────────────────────────────────────────

def _verify_meta_signature(body: bytes, signature_header: str | None) -> None:
    """Constant-time HMAC-SHA256 check of Meta's X-Hub-Signature-256 header.

    Meta signs the raw request body with the App Secret. Fail-closed rule:
    if WhatsApp is live (WA_TOKEN set) the secret is mandatory — a missing
    secret must never silently open the webhook to forged payloads. Only a
    fully unconfigured dev environment skips verification.
    """
    settings = get_settings()
    if not settings.WA_APP_SECRET:
        if settings.WA_TOKEN:
            logger.error("WA_TOKEN set but WA_APP_SECRET missing — rejecting webhook (fail closed)")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Webhook signature verification not configured",
            )
        logger.warning("WA_APP_SECRET unset — webhook signature NOT verified (dev mode)")
        return
    if not signature_header or not signature_header.startswith("sha256="):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing signature")
    expected = hmac.new(settings.WA_APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
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
        await _dispatch_inbound(payload)
    except Exception:
        # Return 500 so Meta redelivers — the wamid unique constraint and
        # idempotent status updates make the retry safe. Swallowing the error
        # here would permanently lose customer messages on a broker/DB blip.
        logger.exception("Webhook dispatch failed — returning 500 so Meta retries")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Dispatch failed",
        )
    return {"status": "ok"}


async def _dispatch_inbound(payload: dict) -> None:
    """Queue inbound texts for processing and apply delivery-status updates."""
    for msg in parse_inbound_texts(payload):
        handle_inbound_reply.delay(msg.wa_id, msg.text, msg.wamid, msg.received_at)
        logger.info("Queued inbound: wa_id=%s wamid=%s", msg.wa_id, msg.wamid)

    statuses = parse_status_updates(payload)
    if statuses:
        async with make_task_session() as session:
            for update in statuses:
                applied = await update_status_by_wamid(session, update.wamid, update.status)
                if not applied:
                    logger.debug("Status %s for unknown/older wamid=%s", update.status, update.wamid)
            await session.commit()


# ─── outbound send (POST) ─────────────────────────────────────────────────────

class SendRequest(BaseModel):
    wa_id: str
    content: str
    message_id: str  # messages.id — the send task updates its status

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
