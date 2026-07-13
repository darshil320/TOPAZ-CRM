"""Celery tasks for WhatsApp Cloud API — salesperson alerts + customer messages.

Auth: Meta System User token (WA_TOKEN) sent as Bearer in Authorization header.
Phone-number-ID (WA_PHONE_NUMBER_ID) identifies the sending business number.
All HTTP calls are synchronous (httpx in sync mode) — Celery workers are sync.

Rate limits: Meta enforces per-number per-second limits; the retry policy here
is conservative (3 attempts, 10s initial delay) and backs off on 429s.
"""

import asyncio
import logging
from uuid import UUID

import httpx

from .celery_app import celery_app
from ..config import get_settings
from ..database import make_task_session
from ..repositories.message_repo import mark_message_failed, mark_message_sent

logger = logging.getLogger(__name__)

_WA_API_BASE = "https://graph.facebook.com/v20.0"
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


def _post_wa_payload(payload: dict) -> str | None:
    """POST a message payload to the WhatsApp Cloud API; return the wamid.

    Returns None when WhatsApp is not configured (dev mode — send skipped).
    Raises httpx.HTTPStatusError on non-2xx responses.
    """
    settings = get_settings()
    if not settings.WA_PHONE_NUMBER_ID or not settings.WA_TOKEN:
        logger.warning("WhatsApp not configured — skipping send to %s", payload.get("to"))
        return None

    url = f"{_WA_API_BASE}/{settings.WA_PHONE_NUMBER_ID}/messages"
    resp = httpx.post(
        url,
        json=payload,
        headers={"Authorization": f"Bearer {settings.WA_TOKEN}"},
        timeout=15,
    )
    resp.raise_for_status()
    wamid = resp.json().get("messages", [{}])[0].get("id")
    logger.info("WhatsApp message sent to %s: wamid=%s", payload.get("to"), wamid)
    return wamid


def send_wa_text(to: str, body: str) -> str | None:
    """Free-form text send (24h service window only). to: E.164 without +."""
    return _post_wa_payload(
        {
            "messaging_product": "whatsapp",
            "to": to.lstrip("+"),
            "type": "text",
            "text": {"body": body},
        }
    )


def _download_face_crop(photo_key: str) -> bytes | None:
    """Fetch a private face-crop from Supabase Storage via the service role.

    Returns None (never raises) when Storage is unconfigured or the object is
    missing — the caller falls back to a text-only alert.
    """
    settings = get_settings()
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        logger.info("Supabase Storage not configured — alert will be text-only")
        return None
    url = (
        f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/"
        f"{settings.FACE_CROP_BUCKET}/{photo_key}"
    )
    try:
        resp = httpx.get(
            url,
            headers={
                "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.content
    except Exception:
        logger.warning("Face-crop download failed for %s — text-only alert", photo_key, exc_info=True)
        return None


def _upload_media_to_meta(jpeg: bytes) -> str | None:
    """Upload image bytes to the WhatsApp Cloud API; return the media id.

    Uploading (vs. a public link) keeps the biometric crop off any public URL —
    Meta holds it transiently for the send. Returns None on any failure.
    """
    settings = get_settings()
    if not settings.WA_PHONE_NUMBER_ID or not settings.WA_TOKEN:
        return None
    url = f"{_WA_API_BASE}/{settings.WA_PHONE_NUMBER_ID}/media"
    try:
        resp = httpx.post(
            url,
            headers={"Authorization": f"Bearer {settings.WA_TOKEN}"},
            data={"messaging_product": "whatsapp", "type": "image/jpeg"},
            files={"file": ("arrival.jpg", jpeg, "image/jpeg")},
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json().get("id")
    except Exception:
        logger.warning("Meta media upload failed — text-only alert", exc_info=True)
        return None


def send_wa_image(to: str, media_id: str, caption: str) -> str | None:
    """Send an uploaded image (by media id) with a caption. 24h-window rules apply."""
    return _post_wa_payload(
        {
            "messaging_product": "whatsapp",
            "to": to.lstrip("+"),
            "type": "image",
            "image": {"id": media_id, "caption": caption},
        }
    )


def send_wa_template(to: str, template_name: str, params: list[dict], lang: str = "en") -> str | None:
    """Approved-template send (allowed outside the 24h window).

    params: prebuilt body-component parameter objects, e.g.
    {"type": "text", "parameter_name": "customer_name", "text": "Hemant"} —
    our registered templates use NAMED parameter format
    (see services/templates.meta_template_params).
    """
    components = []
    if params:
        components.append({"type": "body", "parameters": params})
    return _post_wa_payload(
        {
            "messaging_product": "whatsapp",
            "to": to.lstrip("+"),
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": lang},
                "components": components,
            },
        }
    )


def _record_send_result(message_id: str, wamid: str | None, *, failed: bool = False) -> None:
    """Persist the send outcome on the messages row (best-effort)."""

    async def _update() -> None:
        async with make_task_session() as session:
            if failed:
                await mark_message_failed(session, UUID(message_id))
            elif wamid:
                await mark_message_sent(session, UUID(message_id), wamid)
            await session.commit()

    try:
        asyncio.run(_update())
    except Exception:
        logger.exception("Failed to record send result for message %s", message_id)


@celery_app.task(
    bind=True,
    name="src.tasks.whatsapp.send_salesperson_alert",
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def send_salesperson_alert(
    self,
    salesperson_whatsapp: str,
    customer_id: str,
    visit_id: str,
    customer_name: str | None = None,
    photo_key: str | None = None,
) -> None:
    """WhatsApp alert to a salesperson when their assigned customer walks in.

    Sent immediately after a REPEAT visit is written to the DB.
    salesperson_whatsapp: E.164 number, e.g. "+919426529230".
    photo_key: Storage key of the customer's face crop — attached as an image
    when available; the alert falls back to text if it can't be fetched/uploaded.
    """
    settings = get_settings()
    display = customer_name or "a familiar face"
    dashboard_link = f"{settings.DASHBOARD_URL}/dashboard/customers/{customer_id}"

    body = (
        f"🔔 *Repeat visitor spotted!*\n\n"
        f"{display.title()} just walked into the showroom.\n"
        f"View on dashboard → {dashboard_link}"
    )
    try:
        sent_with_photo = False
        if photo_key:
            jpeg = _download_face_crop(photo_key)
            if jpeg:
                media_id = _upload_media_to_meta(jpeg)
                if media_id:
                    send_wa_image(salesperson_whatsapp, media_id, body)
                    sent_with_photo = True
        if not sent_with_photo:
            send_wa_text(salesperson_whatsapp, body)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in _RETRYABLE_STATUS_CODES:
            raise self.retry(exc=exc)
        logger.error(
            "WhatsApp alert failed (non-retryable %s) for salesperson %s visit %s",
            exc.response.status_code,
            salesperson_whatsapp,
            visit_id,
        )
    except Exception as exc:
        raise self.retry(exc=exc)


@celery_app.task(
    bind=True,
    name="src.tasks.whatsapp.send_customer_message",
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def send_customer_message(
    self,
    wa_id: str,
    content: str,
    message_id: str,
) -> str | None:
    """Send an approved outbound message to a customer and return the wamid.

    wa_id: customer WhatsApp number WITHOUT leading +.
    message_id: the messages.id UUID — updated to sent/failed here after the call.
    """
    try:
        wamid = send_wa_text(wa_id, content)
        if wamid:
            _record_send_result(message_id, wamid)
        else:
            # WhatsApp unconfigured (dev) — mark failed so the dashboard
            # doesn't show the message as pending forever.
            logger.warning("Message %s not sent — WhatsApp unconfigured; marking failed", message_id)
            _record_send_result(message_id, None, failed=True)
        return wamid
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in _RETRYABLE_STATUS_CODES:
            raise self.retry(exc=exc)
        logger.error(
            "Customer message send failed (non-retryable %s) for message %s",
            exc.response.status_code,
            message_id,
        )
        _record_send_result(message_id, None, failed=True)
        return None
    except Exception as exc:
        # AMBIGUOUS SEND: the request may have reached Meta before the error —
        # the Celery retry could double-send. Logged distinctly for audit.
        logger.warning(
            "AMBIGUOUS SEND: message %s errored mid-flight — retrying; duplicate possible",
            message_id,
        )
        raise self.retry(exc=exc)
