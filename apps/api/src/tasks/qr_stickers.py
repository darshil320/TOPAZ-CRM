"""Celery task: render a QR sticker sheet to PDF and store it (0053).

Lives in the worker because headless Chromium spikes ~1GB per render and the api
container is capped at 1GB (infra/hetzner/docker-compose.prod.yml) — same reason the
quotation PDF does. The API queues it (POST /products/stickers) and serves the signed
URL once the object exists (GET /products/stickers/{job_id}).

The payload is only what a sticker prints — product name + QR code — so the worker
needs no database and a sticker can never carry a price.
"""

import logging

from ..config import get_settings
from ..services import pdf as pdf_engine
from ..services import qr_stickers
from ..services.storage import upload_bytes
from .celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    name="src.tasks.qr_stickers.render_qr_stickers",
    max_retries=2,
    default_retry_delay=5,
    acks_late=True,
)
def render_qr_stickers(
    self, job_id: str, products: list[dict], size: str, layout: str, copies: int, base_url: str
) -> str | None:
    """Render + store; returns the storage key. A bad request is not retried."""
    try:
        html = qr_stickers.render_stickers_html(
            products, size_key=size, layout=layout, copies=copies, base_url=base_url
        )
    except qr_stickers.StickerError as exc:
        logger.error("Sticker job %s refused: %s", job_id, exc)
        return None
    try:
        pdf = pdf_engine.render_html_to_pdf(html, css_page_size=True)
        key = upload_bytes(get_settings().DOCUMENTS_BUCKET, qr_stickers.sticker_pdf_key(job_id), pdf)
    except Exception as exc:  # noqa: BLE001 — render/upload are both transient; retried
        logger.warning("Sticker job %s failed: %s", job_id, exc)
        raise self.retry(exc=exc)
    logger.info("Sticker job %s → %s (%d products x %d)", job_id, key, len(products), copies)
    return key
