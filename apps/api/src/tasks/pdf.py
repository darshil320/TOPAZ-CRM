"""Celery task: render a quotation to PDF and file it in Storage + the registry.

Sync task (Celery worker); the async repo calls run via asyncio.run in one
transaction. Retries on transient render/upload failures.
"""

import asyncio
import logging
from uuid import UUID

from sqlalchemy import text

from .celery_app import celery_app
from ..config import get_settings
from ..database import make_task_session
from ..repositories import document_repo, quotation_repo as repo
from ..services import pdf as pdf_engine
from ..services import quote_html
from ..services.storage import upload_bytes

logger = logging.getLogger(__name__)


async def _load_customer(session, customer_id: UUID) -> dict:
    result = await session.execute(
        text("SELECT name, phone FROM customers WHERE id = :id"), {"id": str(customer_id)}
    )
    row = result.mappings().first()
    return dict(row) if row else {"name": None, "phone": None}


async def _render_and_store(quotation_id: UUID) -> str | None:
    settings = get_settings()
    async with make_task_session() as session:
        quote = await repo.get_quotation(session, quotation_id)
        if quote is None:
            logger.error("Quotation %s not found — cannot render PDF", quotation_id)
            return None
        customer = await _load_customer(session, UUID(str(quote["customer_id"])))

        html = quote_html.render_quote_html(quote, customer)
        # render_html_to_pdf uses Playwright's SYNC API, which refuses to run
        # inside a running asyncio loop (this coroutine runs under asyncio.run).
        # Offload to a worker thread — it has no event loop, so the sync API is
        # valid there. Keeps the engine sync + import-light (CLAUDE.md).
        pdf_bytes = await asyncio.to_thread(pdf_engine.render_html_to_pdf, html)

        key = f"quotes/{quote['quote_no']}-r{quote.get('revision_no', 1)}.pdf"
        upload_bytes(settings.DOCUMENTS_BUCKET, key, pdf_bytes, "application/pdf")

        version = await document_repo.next_version(session, "quotation", quotation_id)
        await document_repo.insert_document(
            session, kind="quotation_pdf", entity_type="quotation",
            entity_id=quotation_id, storage_key=key, version=version,
        )
        await repo.set_pdf_key(session, quotation_id, key)
        await session.commit()
    logger.info("Rendered quotation %s → %s", quotation_id, key)
    return key


@celery_app.task(
    bind=True,
    name="src.tasks.pdf.render_quotation_pdf",
    max_retries=3,
    default_retry_delay=15,
    acks_late=True,
)
def render_quotation_pdf(self, quotation_id: str) -> str | None:
    """Render + store the quotation PDF; returns the storage key (or None)."""
    try:
        return asyncio.run(_render_and_store(UUID(quotation_id)))
    except Exception as exc:  # render/upload/db — all retryable
        logger.warning("render_quotation_pdf failed for %s: %s", quotation_id, exc)
        raise self.retry(exc=exc)
