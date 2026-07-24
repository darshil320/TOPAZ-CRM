"""Celery tasks for the quotation send + approval flow (module 03).

Every customer-facing send routes through the 24h-window branch (WhatsApp rule):
free-form inside the window, approved template outside. Customer DOCUMENT
delivery is additionally gated by WA_MEDIA_ENABLED until WA-MEDIA-SPIKE + Meta
Business Verification clear — until then the customer still gets the approval
LINK (text/template), which is enough to view + approve.
"""

import asyncio
import logging
from uuid import UUID

import httpx
from sqlalchemy import text

from .celery_app import celery_app
from .pdf import _render_and_store
from .whatsapp import (
    _upload_document_to_meta,
    send_wa_document,
    send_wa_template,
    send_wa_text,
)
from ..config import get_settings
from ..database import make_task_session
from ..repositories import message_repo, quotation_repo as repo
from ..services.storage import signed_url
from ..services.wa_window import within_service_window

logger = logging.getLogger(__name__)
_RETRYABLE = {429, 500, 502, 503, 504}


def _public_link(token: str) -> str:
    return f"{get_settings().DASHBOARD_URL.rstrip('/')}/q/{token}"


async def _salesperson_wa(session, customer_id: str) -> str | None:
    """Primary (or any active) salesperson's WhatsApp for a customer; else owner."""
    result = await session.execute(
        text(
            "SELECT s.whatsapp FROM customer_assignments ca"
            " JOIN salespersons s ON s.id = ca.salesperson_id"
            " WHERE ca.customer_id = :cid AND ca.active = true"
            " ORDER BY (ca.role = 'primary') DESC, ca.created_at ASC LIMIT 1"
        ),
        {"cid": str(customer_id)},
    )
    row = result.first()
    if row and row[0]:
        return row[0]
    owner = await session.execute(
        text("SELECT whatsapp FROM salespersons WHERE role = 'owner' AND active = true LIMIT 1")
    )
    r = owner.first()
    return r[0] if r else None


async def _send_quote(quotation_id: UUID) -> None:
    settings = get_settings()
    async with make_task_session() as session:
        ctx = await repo.get_send_context(session, quotation_id)
        if ctx is None:
            logger.error("Quote %s not found — cannot send", quotation_id)
            return
        if not ctx["wa_id"]:
            logger.warning("Quote %s customer has no wa_id — send skipped", quotation_id)
            return

        # Idempotency guard (retry-safe): flip draft→sent FIRST and commit. On a
        # retry the row is no longer 'draft', so mark_sent returns False and we
        # bail out BEFORE re-sending — customer messages can't be un-sent, so a
        # missed send is preferable to a duplicate (code-review HIGH).
        if not await repo.mark_sent(session, quotation_id):
            logger.info("Quote %s already sent — skipping resend", quotation_id)
            return
        await session.commit()

        # Ensure a PDF exists (render inline if the earlier task hasn't run).
        if not ctx.get("pdf_key"):
            await _render_and_store(quotation_id)
            ctx = await repo.get_send_context(session, quotation_id)

        link = _public_link(str(ctx["approval_token"]))
        name = (ctx["customer_name"] or "there").split(" ")[0]
        in_window = within_service_window(ctx["last_inbound_at"])
        wamid = None
        template_name = None

        # 1) Optional document delivery (flag + open window + storage configured).
        if settings.WA_MEDIA_ENABLED and in_window and ctx.get("pdf_key"):
            try:
                url = signed_url(settings.DOCUMENTS_BUCKET, ctx["pdf_key"])
                pdf = httpx.get(url, timeout=30).content
                media_id = _upload_document_to_meta(pdf, f"{ctx['quote_no']}.pdf")
                if media_id:
                    send_wa_document(
                        ctx["wa_id"], media_id, f"{ctx['quote_no']}.pdf",
                        f"Hi {name}, here is your quotation {ctx['quote_no']}. "
                        f"Review & approve here: {link}",
                    )
            except Exception:
                logger.warning("Document delivery failed for %s — falling back to link", quotation_id, exc_info=True)

        # 2) Always deliver the approval LINK (text inside window, template outside).
        body = (
            f"Hi {name}, your quotation {ctx['quote_no']} from Topaz Furniture is ready. "
            f"View the details and approve here: {link}"
        )
        if in_window:
            wamid = send_wa_text(ctx["wa_id"], body)
        else:
            template_name = "quote_sent"
            wamid = send_wa_template(
                ctx["wa_id"], template_name,
                [
                    {"type": "text", "parameter_name": "customer_name", "text": name},
                    {"type": "text", "parameter_name": "quote_no", "text": ctx["quote_no"]},
                    {"type": "text", "parameter_name": "link", "text": link},
                ],
            )

        await message_repo.create_message(
            session, customer_id=UUID(str(ctx["customer_id"])), direction="outbound",
            content=body, sender_type="system", status="sent" if wamid else "pending",
            wamid=wamid, category="utility", template_name=template_name,
        )
        # status already flipped to 'sent' above (retry guard)
        await session.commit()
    logger.info("Quote %s sent (wamid=%s, template=%s)", quotation_id, wamid, template_name)


@celery_app.task(bind=True, name="src.tasks.quotes.send_quotation",
                 max_retries=3, default_retry_delay=15, acks_late=True)
def send_quotation(self, quotation_id: str) -> None:
    try:
        asyncio.run(_send_quote(UUID(quotation_id)))
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in _RETRYABLE:
            raise self.retry(exc=exc)
        logger.error("send_quotation non-retryable %s for %s", exc.response.status_code, quotation_id)
    except Exception as exc:
        raise self.retry(exc=exc)


async def _notify_decision(quotation_id: UUID, approved: bool) -> None:
    async with make_task_session() as session:
        ctx = await repo.get_send_context(session, quotation_id)
        if ctx is None:
            return
        name = (ctx["customer_name"] or "there").split(" ")[0]
        link = _public_link(str(ctx["approval_token"]))
        in_window = within_service_window(ctx["last_inbound_at"])

        # Customer confirmation.
        if ctx["wa_id"]:
            if approved:
                body = (f"Thank you, {name}! Quotation {ctx['quote_no']} is confirmed. "
                        f"Our team will reach out with the next steps.")
            else:
                body = (f"Thanks {name}. We've noted your feedback on {ctx['quote_no']}; "
                        f"your advisor will follow up to revise it.")
            try:
                if in_window:
                    send_wa_text(ctx["wa_id"], body)
                elif approved:
                    send_wa_template(
                        ctx["wa_id"], "quote_approved_confirm",
                        [{"type": "text", "parameter_name": "customer_name", "text": name},
                         {"type": "text", "parameter_name": "quote_no", "text": ctx["quote_no"]}],
                    )
            except Exception:
                logger.warning("Customer decision confirm failed for %s", quotation_id, exc_info=True)

        # Salesperson alert (internal — always free-form to staff).
        sp_wa = await _salesperson_wa(session, str(ctx["customer_id"]))
        if sp_wa:
            verb = "APPROVED ✅" if approved else "requested changes ✏️"
            dash = f"{get_settings().DASHBOARD_URL.rstrip('/')}/dashboard/quotes/{quotation_id}"
            try:
                send_wa_text(sp_wa, f"Quote {ctx['quote_no']} {verb} by {ctx['customer_name'] or 'customer'}.\n{dash}")
            except Exception:
                logger.warning("Salesperson decision alert failed for %s", quotation_id, exc_info=True)
        await session.commit()


@celery_app.task(bind=True, name="src.tasks.quotes.notify_quote_decision",
                 max_retries=3, default_retry_delay=10, acks_late=True)
def notify_quote_decision(self, quotation_id: str, approved: bool) -> None:
    try:
        asyncio.run(_notify_decision(UUID(quotation_id), approved))
    except Exception as exc:
        raise self.retry(exc=exc)
