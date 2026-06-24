"""Celery tasks for WhatsApp Cloud API — salesperson alerts + customer messages.

Auth: Meta System User token (WA_TOKEN) sent as Bearer in Authorization header.
Phone-number-ID (WA_PHONE_NUMBER_ID) identifies the sending business number.
All HTTP calls are synchronous (httpx in sync mode) — Celery workers are sync.

Rate limits: Meta enforces per-number per-second limits; the retry policy here
is conservative (3 attempts, 10s initial delay) and backs off on 429s.
"""

import logging
from uuid import UUID

import httpx

from .celery_app import celery_app
from ..config import get_settings

logger = logging.getLogger(__name__)

_WA_API_BASE = "https://graph.facebook.com/v20.0"
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


def _send_wa_text(to: str, body: str) -> None:
    """POST a text message to the WhatsApp Cloud API (synchronous).

    to: E.164 number WITHOUT the leading +, e.g. "919426529230".
    Raises httpx.HTTPStatusError on non-retryable failures.
    """
    settings = get_settings()
    if not settings.WA_PHONE_NUMBER_ID or not settings.WA_TOKEN:
        logger.warning("WhatsApp not configured — skipping send to %s", to)
        return

    url = f"{_WA_API_BASE}/{settings.WA_PHONE_NUMBER_ID}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": to.lstrip("+"),
        "type": "text",
        "text": {"body": body},
    }
    resp = httpx.post(
        url,
        json=payload,
        headers={"Authorization": f"Bearer {settings.WA_TOKEN}"},
        timeout=15,
    )
    resp.raise_for_status()
    logger.info("WhatsApp message sent to %s: wamid=%s", to, resp.json().get("messages", [{}])[0].get("id"))


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
        _send_wa_text(salesperson_whatsapp, body)
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
    message_id: the messages.id UUID; caller should update status on success.
    """
    try:
        settings = get_settings()
        if not settings.WA_PHONE_NUMBER_ID or not settings.WA_TOKEN:
            logger.warning("WhatsApp not configured — skipping customer send")
            return None

        url = f"{_WA_API_BASE}/{settings.WA_PHONE_NUMBER_ID}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "to": wa_id.lstrip("+"),
            "type": "text",
            "text": {"body": content},
        }
        resp = httpx.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {settings.WA_TOKEN}"},
            timeout=15,
        )
        resp.raise_for_status()
        wamid: str = resp.json()["messages"][0]["id"]
        logger.info("Customer message sent: wamid=%s message_id=%s", wamid, message_id)
        return wamid
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in _RETRYABLE_STATUS_CODES:
            raise self.retry(exc=exc)
        logger.error(
            "Customer message send failed (non-retryable %s) for message %s",
            exc.response.status_code,
            message_id,
        )
        return None
    except Exception as exc:
        raise self.retry(exc=exc)
