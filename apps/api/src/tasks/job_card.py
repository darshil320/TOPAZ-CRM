"""Celery tasks: render a job card (spec sheet), file it, and send it.

Two audiences, ONE artifact — the customer (alongside the priced quotation PDF)
and the workshop (as the production sheet). The document carries no money, so
there is no wrong-variant risk in sending the same file to both.

TWO OUTPUT FORMATS, ONE TEMPLATE (settings.JOB_CARD_FORMAT):
  * 'image' (default) — JPEG pages that open INLINE in WhatsApp. No PDF viewer, no
    download, no taps. That is decisive for a workshop manager on a mid-range
    Android, and it is the delivery path already proven in production (the arrival
    alert sends images through the same `_upload_media_to_meta`/`send_wa_image`).
    A long card becomes several pages: one tall JPEG of 15 rows turns into an
    unreadable ribbon once WhatsApp recompresses it.
  * 'pdf' — the printable/filable document.
Both render the SAME HTML, so the layouts cannot drift.

`documents.entity_type` is the source name verbatim ("quotation" / "order"), and
api/job_cards.py reads the registry with that same raw string — no private mapping
here, which would let the two drift into a permanent 404 on /url while sends kept
working.

Photos are inlined as base64 data URIs BEFORE rendering. Playwright must never be
asked to fetch a private-bucket URL mid-render: it lacks the auth, and
`wait_until="networkidle"` would stall on it. (STATE.md 2026-07-26 / commit
0a43348 — the last time this pipeline was bitten by render-time I/O.)
"""

import asyncio
import base64
import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .celery_app import celery_app
from .whatsapp import (
    _upload_document_to_meta,
    _upload_media_to_meta,
    send_wa_document,
    send_wa_image,
)
from ..config import get_settings
from ..database import make_task_session
from ..repositories import document_repo, job_card_repo, message_repo
from ..services import job_card_html
from ..services import pdf as pdf_engine
from ..services.storage import StorageError, download_bytes, upload_bytes
from ..services.wa_window import within_service_window

logger = logging.getLogger(__name__)

_MIME_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}

IMAGE_KIND = "job_card_image"
PDF_KIND = "job_card_pdf"


def _doc_kind(fmt: str) -> str:
    return IMAGE_KIND if fmt == "image" else PDF_KIND


def _data_uri(key: str, raw: bytes) -> str:
    ext = key.rsplit(".", 1)[-1].lower()
    mime = _MIME_BY_EXT.get(ext, "image/jpeg")
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def _inline_photos(items: list[dict]) -> list[dict]:
    """Fetch each resolved photo and inline it. Returns NEW dicts.

    A photo that cannot be fetched, or is too big to embed, is dropped to None
    rather than raised: one bad image must not cost the workshop its entire job
    card. The template prints "No photo" for that row and the reason is logged.

    The size cap is not paranoia — the resolver prefers 400px thumbnails but falls
    back to the full original whenever the thumbnail worker hasn't run yet, so
    without it a few un-thumbnailed items can put tens of MB (plus ~33% base64)
    into worker memory and produce a file WhatsApp will refuse.
    """
    settings = get_settings()
    out = []
    for it in items:
        uri = None
        key = it.get("photo_key")
        if key:
            try:
                raw = download_bytes(settings.MEDIA_BUCKET, key)
                if len(raw) > settings.JOB_CARD_MAX_INLINE_BYTES:
                    logger.warning(
                        "Job card photo %s is %d bytes (cap %d) — rendering without it",
                        key, len(raw), settings.JOB_CARD_MAX_INLINE_BYTES,
                    )
                else:
                    uri = _data_uri(key, raw)
            except StorageError as exc:
                logger.warning("Job card photo %s unreadable — rendering without it: %s", key, exc)
        out.append({**it, "photo_data_uri": uri})
    return out


async def _load(session: AsyncSession, source: str, entity_id: UUID) -> dict | None:
    if source == "quotation":
        return await job_card_repo.quotation_job_card(session, entity_id)
    if source == "order":
        return await job_card_repo.order_job_card(session, entity_id)
    raise ValueError(f"Unknown job card source '{source}'")


def _render_pages(header: dict, items: list[dict], fmt: str) -> list[tuple[str, bytes]]:
    """Render the card. Returns [(filename_suffix, bytes), ...] — one entry for a
    PDF, one per page for images. Pure-ish: no DB, no Storage, only the browser."""
    settings = get_settings()
    if fmt == "pdf":
        html = job_card_html.render_job_card_html(header, items)
        return [("pdf", pdf_engine.render_html_to_pdf(html))]

    pages = job_card_html.paginate(items, settings.JOB_CARD_ITEMS_PER_IMAGE)
    rendered: list[tuple[str, bytes]] = []
    offset = 0
    for index, page_items in enumerate(pages, start=1):
        html = job_card_html.render_job_card_html(
            header, page_items, sr_offset=offset, page=index, page_count=len(pages)
        )
        rendered.append((
            # Zero-padded so storage-key ordering is page ordering past page 9.
            f"{index:02d}.jpg",
            pdf_engine.render_html_to_image(
                html,
                width_px=settings.JOB_CARD_IMAGE_WIDTH_PX,
                quality=settings.JOB_CARD_IMAGE_QUALITY,
                scale=settings.JOB_CARD_IMAGE_SCALE,
            ),
        ))
        offset += len(page_items)
    return rendered


async def _render_and_store(source: str, entity_id: UUID) -> list[str] | None:
    """Render + upload + register. Returns the storage keys in page order, or None
    if the parent record is gone or has no items."""
    settings = get_settings()
    fmt = settings.JOB_CARD_FORMAT
    kind = _doc_kind(fmt)

    async with make_task_session() as session:
        data = await _load(session, source, entity_id)
        if data is None:
            logger.error("No %s %s — cannot render job card", source, entity_id)
            return None
        if not data["items"]:
            logger.error("%s %s has no items — refusing to render an empty job card",
                         source, entity_id)
            return None

        items = _inline_photos(data["items"])
        header = data["header"]
        doc_no = header["doc_no"]

        # Sync Playwright cannot run inside this asyncio.run loop — offload to a
        # thread (which has no running loop). Same fix as tasks/pdf.py.
        pages = await asyncio.to_thread(_render_pages, header, items, fmt)

        version = await document_repo.next_version(session, source, entity_id)
        keys: list[str] = []
        for suffix, blob in pages:
            key = (f"job-cards/{doc_no}.pdf" if fmt == "pdf"
                   else f"job-cards/{doc_no}-{suffix}")
            content_type = "application/pdf" if fmt == "pdf" else "image/jpeg"
            upload_bytes(settings.DOCUMENTS_BUCKET, key, blob, content_type)
            # All pages of one render share a version — that is what makes
            # latest_storage_keys() return a complete, self-consistent set.
            await document_repo.insert_document(
                session, kind=kind, entity_type=source, entity_id=entity_id,
                storage_key=key, version=version,
            )
            keys.append(key)
        await session.commit()

    logger.info("Rendered job card for %s %s as %s: %d page(s), %d bytes total",
                source, entity_id, fmt, len(pages), sum(len(b) for _, b in pages))
    return keys


@celery_app.task(bind=True, name="src.tasks.job_card.render_job_card",
                 max_retries=3, default_retry_delay=15, acks_late=True)
def render_job_card(self, source: str, entity_id: str) -> list[str] | None:
    try:
        return asyncio.run(_render_and_store(source, UUID(entity_id)))
    except Exception as exc:
        logger.warning("render_job_card failed for %s %s: %s", source, entity_id, exc)
        raise self.retry(exc=exc)


def _send_pages(to_number: str, blobs: list[tuple[str, bytes]], fmt: str,
                caption: str) -> bool:
    """Push one card (1..n pages) to a single number. True if everything landed.

    The caption rides on the FIRST page only — repeating it on every image turns a
    3-page card into three identical-looking notifications.
    """
    ok = True
    for index, (filename, blob) in enumerate(blobs):
        page_caption = caption if index == 0 else ""
        if fmt == "pdf":
            media_id = _upload_document_to_meta(blob, filename)
            wamid = send_wa_document(to_number, media_id, filename, page_caption) if media_id else None
        else:
            media_id = _upload_media_to_meta(blob)
            wamid = send_wa_image(to_number, media_id, page_caption) if media_id else None
        if wamid is None:
            logger.warning("Job card page %s failed to send", filename)
            ok = False
    return ok


async def _send(source: str, entity_id: UUID, to: str) -> None:
    """Deliver an already-rendered job card. Renders first if none exists yet."""
    settings = get_settings()
    fmt = settings.JOB_CARD_FORMAT
    kind = _doc_kind(fmt)

    # WA_MEDIA_ENABLED is the global "outbound media is not approved yet" kill
    # switch (Meta Business Verification). It applies to BOTH audiences: a workshop
    # manager's handset is still an outbound media send through the same Cloud API,
    # so exempting staff would quietly defeat the flag it exists to honour.
    if not settings.WA_MEDIA_ENABLED:
        logger.info("WA_MEDIA_ENABLED=false — job card for %s %s not sent to %s",
                    source, entity_id, to)
        return

    async with make_task_session() as session:
        data = await _load(session, source, entity_id)
        if data is None:
            logger.error("No %s %s — cannot send job card", source, entity_id)
            return
        keys = await document_repo.latest_storage_keys(session, source, entity_id, kind)
        recipients: list[dict] = []
        if to == "workshop":
            if source != "order":
                logger.error("Workshop job cards come from orders, not %s", source)
                return
            recipients = await job_card_repo.workshop_recipients(session, entity_id)
        customer_wa = data["wa_id"]
        customer_id = data["customer_id"]
        doc_no = data["header"]["doc_no"]
        client_name = (data["header"]["client_name"] or "there").split(" ")[0]
        # last_inbound_at drives the 24h service window for the customer path.
        in_window = False
        if to == "customer":
            row = await session.execute(
                text("SELECT last_inbound_at FROM customers WHERE id = :id"),
                {"id": customer_id},
            )
            in_window = within_service_window(row.scalar_one_or_none())

    # Every remaining skip reason is known BEFORE the files are fetched — check them
    # first so a "filed, not sent" outcome costs no Storage round-trip (the shape
    # tasks/quotes.py already uses).
    if to == "workshop":
        if not recipients:
            logger.info("No active workshop allocated for %s %s — job card not sent",
                        source, entity_id)
            return
    else:
        if not customer_wa:
            logger.info("Customer for %s %s has no WhatsApp id — job card filed, not sent",
                        source, entity_id)
            return
        if not in_window:
            # No approved template exists for a job card, so outside the window
            # there is nothing lawful to send. Skip loudly; never silently drop.
            logger.info("24h window closed for %s %s — job card filed, not sent (no template)",
                        source, entity_id)
            return

    if not keys:
        rendered = await _render_and_store(source, entity_id)
        if not rendered:
            return
        keys = rendered

    try:
        blobs = [(k.rsplit("/", 1)[-1], download_bytes(settings.DOCUMENTS_BUCKET, k))
                 for k in keys]
    except StorageError as exc:
        logger.error("Job card for %s %s unreadable — not sending: %s", source, entity_id, exc)
        return

    if to == "workshop":
        _send_to_workshops(recipients, blobs, fmt, doc_no, client_name)
        return

    caption = f"Hi {client_name}, here are the specifications for {doc_no} — Topaz Furniture."
    if not _send_pages(customer_wa, blobs, fmt, caption):
        logger.warning("Job card send incomplete for %s %s", source, entity_id)
        return
    async with make_task_session() as session:
        await message_repo.create_message(
            session, customer_id=UUID(customer_id), direction="outbound",
            content=caption, sender_type="system", status="sent",
        )
        await session.commit()


def _send_to_workshops(recipients: list[dict], blobs: list[tuple[str, bytes]], fmt: str,
                       doc_no: str, client_name: str) -> None:
    """One send per workshop holding items of this order.

    A workshop with no manager_phone is logged BY NAME — "sent to 2 of 3 workshops"
    with no way to tell which one was missed is a support ticket waiting to happen.
    """
    caption = f"Job card {doc_no} — {client_name}. Topaz Furniture."
    for w in recipients:
        phone = w.get("manager_phone")
        if not phone:
            logger.warning("Workshop '%s' has no manager_phone — job card %s not delivered there",
                           w.get("name"), doc_no)
            continue
        if _send_pages(phone, blobs, fmt, caption):
            logger.info("Job card %s sent to workshop '%s' (%d page(s))",
                        doc_no, w.get("name"), len(blobs))
        else:
            logger.warning("Job card %s send incomplete to workshop '%s'", doc_no, w.get("name"))


@celery_app.task(bind=True, name="src.tasks.job_card.send_job_card",
                 max_retries=3, default_retry_delay=15, acks_late=True)
def send_job_card(self, source: str, entity_id: str, to: str) -> None:
    try:
        asyncio.run(_send(source, UUID(entity_id), to))
    except Exception as exc:
        logger.warning("send_job_card failed for %s %s → %s: %s", source, entity_id, to, exc)
        raise self.retry(exc=exc)
