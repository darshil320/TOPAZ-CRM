"""Celery task: render a payment receipt PDF, file it, and (optionally) WhatsApp
it to the customer. Customer receipt send is gated by SEND_RECEIPTS_TO_CUSTOMER
until the client confirms the policy (STATE.md)."""

import asyncio
import logging
from uuid import UUID

from sqlalchemy import text

from .celery_app import celery_app
from .whatsapp import send_wa_text
from ..config import get_settings
from ..database import make_task_session
from ..repositories import document_repo
from ..services import pdf as pdf_engine
from ..services import receipt_html
from ..services.storage import upload_bytes
from ..services.wa_window import within_service_window

logger = logging.getLogger(__name__)


async def _render(payment_id: UUID) -> str | None:
    settings = get_settings()
    async with make_task_session() as session:
        pay = (await session.execute(
            text("SELECT * FROM payments WHERE id = :id"), {"id": str(payment_id)}
        )).mappings().first()
        if pay is None:
            logger.error("Payment %s not found — cannot render receipt", payment_id)
            return None
        order = (await session.execute(
            text("SELECT order_no, grand_total FROM orders WHERE id = :id"),
            {"id": str(pay["order_id"])},
        )).mappings().first()
        customer = (await session.execute(
            text("SELECT name, phone, wa_id, last_inbound_at FROM customers WHERE id = :id"),
            {"id": str(pay["customer_id"])},
        )).mappings().first()

        html = receipt_html.render_receipt_html(dict(pay), dict(order), dict(customer))
        pdf_bytes = pdf_engine.render_html_to_pdf(html)
        key = f"receipts/{pay['receipt_no']}.pdf"
        upload_bytes(settings.DOCUMENTS_BUCKET, key, pdf_bytes, "application/pdf")

        version = await document_repo.next_version(session, "payment", payment_id)
        await document_repo.insert_document(
            session, kind="receipt_pdf", entity_type="payment", entity_id=payment_id,
            storage_key=key, version=version,
        )
        await session.commit()

        # Optional customer receipt over WhatsApp (flagged off by default).
        # Wrapped so a send failure never restarts the task (which would
        # re-render + re-send — code-review HIGH). The PDF + registry row are
        # already committed above; the WA message is best-effort.
        if settings.SEND_RECEIPTS_TO_CUSTOMER and customer["wa_id"] and within_service_window(
            customer["last_inbound_at"]
        ):
            try:
                name = (customer["name"] or "there").split(" ")[0]
                verb = "refund of" if pay["kind"] == "refund" else "payment of"
                send_wa_text(
                    customer["wa_id"],
                    f"Hi {name}, we've recorded your {verb} ₹{pay['amount']} for order "
                    f"{order['order_no']}. Receipt {pay['receipt_no']}. Thank you — Topaz Furniture.",
                )
            except Exception:
                logger.warning("Receipt WA send failed for %s (PDF already filed)", payment_id, exc_info=True)
    logger.info("Rendered receipt %s → %s", payment_id, key)
    return key


@celery_app.task(bind=True, name="src.tasks.receipts.render_receipt",
                 max_retries=3, default_retry_delay=15, acks_late=True)
def render_receipt(self, payment_id: str) -> str | None:
    try:
        return asyncio.run(_render(UUID(payment_id)))
    except Exception as exc:
        logger.warning("render_receipt failed for %s: %s", payment_id, exc)
        raise self.retry(exc=exc)
