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
) -> None:
    """WhatsApp alert to a salesperson when their assigned customer walks in.

    Sent immediately after a REPEAT visit is written to the DB.
    salesperson_whatsapp: E.164 number, e.g. "+919426529230".
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
