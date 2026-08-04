"""Celery task: render a delivery challan PDF and file it (0037, per-consignment since 0040).

Mirrors tasks/receipts.py — gather → render → Storage → `documents` row — with three
differences that matter:

  1. **The unit is a CONSIGNMENT, not a delivery.** A run can carry goods for two customers
     (0040); each recipient signs their own paper, so each gets their own challan. The
     consignment grain is `(delivery, customer)`, which is exactly one challan — and it also
     means one recipient's several orders share ONE document and ONE signature, which is
     what their pad does.
  2. **The number is allocated ONCE.** `delivery_consignments.challan_no` is UNIQUE; a
     re-render reuses it and bumps `documents.version`. A challan number is a reference a
     transport officer may quote back weeks later, so it must not move because somebody
     regenerated the PDF.
  3. **The lines come from `delivery_items`, never from an order.** Reading an order's items
     would put goods on the paper that are still in a workshop, or goods belonging to the
     other customer on the same lorry.

The layout is the client's own (sample "T.F 66") — a PRODUCT / RECEIVED tick table, a
Balance Amount line, and two signature blocks. It carries no HSN, no rates and no GST, so
nothing here computes tax.

Layout lives entirely in services/challan_html.py + templates/challan.html; the reads live
in repositories/delivery_repo.py. This module is only the orchestration between them.
"""

import asyncio
import logging
from uuid import UUID

from .celery_app import celery_app
from ..config import get_settings
from ..database import make_task_session
from ..repositories import delivery_repo, document_repo
from ..services import challan_html, numbering
from ..services import pdf as pdf_engine
from ..services.storage import upload_bytes

logger = logging.getLogger(__name__)

_SERIES = "CHL"
# Documents are filed against the consignment, because that is what the PDF is OF. Legacy
# challans rendered before 0040 are filed under ('delivery', delivery_id) — api/documents.py
# falls back to that key so they stay downloadable.
ENTITY = "delivery_consignment"
LEGACY_ENTITY = "delivery"
KIND = "challan_pdf"


def _slug(challan_no: str) -> str:
    """A Storage-key-safe form of a human challan number. Pure."""
    return "".join(ch if ch.isalnum() else "-" for ch in challan_no).strip("-").replace("--", "-")


async def _ensure_challan_no(session, consignment_id: UUID) -> str | None:
    """Allocate this consignment's challan number if it has none; else return the existing."""
    existing = await delivery_repo.consignment_or_none(session, consignment_id)
    if existing is None:
        return None
    if existing["challan_no"]:
        return str(existing["challan_no"])

    # Continuous counter, their prefix: "T.F 66". A fiscal-year series would restart every
    # April and duplicate numbers they have already issued by hand (0037's ops note).
    challan_no = await numbering.allocate_continuous(
        session, _SERIES, prefix=get_settings().CHALLAN_NO_PREFIX
    )
    claimed = await delivery_repo.claim_challan_no(session, consignment_id, challan_no)
    if claimed != challan_no:
        # Lost the race. The allocated number is simply skipped — a gap in a challan series
        # is acceptable (and normal); two challans sharing a number is not.
        logger.info("Challan number %s skipped — consignment %s was numbered concurrently",
                    challan_no, consignment_id)
    return claimed


async def _gather(session, consignment_id: UUID) -> dict | None:
    """Everything the layout needs, in the shape services/challan_html documents.

    Only what their format actually prints is read. No HSN, no rates, no tax — their
    challan has none, and selecting money we do not print would be an invitation to
    print it.
    """
    head = await delivery_repo.challan_head(session, consignment_id)
    if head is None:
        return None

    lines = await delivery_repo.challan_lines(session, consignment_id)
    if not lines:
        # Not recoverable by falling back to "the whole order": with a mixed-customer run
        # there is no single order to fall back TO, and printing the wrong customer's goods
        # on a document they sign is worse than printing nothing. 0040 guarantees a
        # consignment is derived FROM items, so this means the rows were deleted.
        logger.error("Consignment %s has no item lines — refusing to print an empty challan",
                     consignment_id)
        return None

    return {
        "challan_no": head["challan_no"],
        "challan_date": head["scheduled_date"],
        "dp_code": head["dp_code"],
        "balance_due": head["balance_due"],
        "customer": {
            "name": head["customer_name"],
            # Their ADDRESS line is the SHIP-TO, which belongs to the CONSIGNMENT: the same
            # lorry may drop one customer at a site and another at a flat, and `customers`
            # has no address column at all (0002).
            "address": head["delivery_address"],
            "mobile": head["customer_phone"],
        },
        "delivery": {
            "tempo_number": head["vehicle_no"],
            "driver_name": head["driver_name"],
            "driver_phone": head["driver_phone"],
            "delivery_rent": head["delivery_rent"],
            "notes": head["notes"],
        },
        # `order_no` per line: challan_html prints it as a sub-label ONLY when this
        # consignment spans more than one order, so a single-order run is unchanged.
        "items": [dict(line) for line in lines],
    }


async def _render(consignment_id: UUID) -> str | None:
    settings = get_settings()
    async with make_task_session() as session:
        challan_no = await _ensure_challan_no(session, consignment_id)
        if challan_no is None:
            logger.error("Consignment %s not found — cannot render a challan", consignment_id)
            return None
        # Commit the number before the (slow, fallible) render: if Playwright dies, the
        # retry must reuse this number rather than burn another one.
        await session.commit()

        challan = await _gather(session, consignment_id)
        if challan is None:
            return None

        html = challan_html.render_challan_html(challan)
        # Sync Playwright cannot run inside this asyncio.run loop — offload to a thread
        # (no event loop there). Same reasoning as tasks/pdf.py and tasks/receipts.py.
        pdf_bytes = await asyncio.to_thread(pdf_engine.render_html_to_pdf, html)

        # Slugified: their number contains a dot and a space ("T.F 66"), and a Storage
        # key is also a URL path segment. "T.F 66" → "TF-66".
        key = f"challans/{_slug(challan_no)}.pdf"
        upload_bytes(settings.DOCUMENTS_BUCKET, key, pdf_bytes, "application/pdf")

        version = await document_repo.next_version(session, ENTITY, consignment_id)
        await document_repo.insert_document(
            session, kind=KIND, entity_type=ENTITY, entity_id=consignment_id,
            storage_key=key, version=version,
        )
        await session.commit()

    logger.info("Rendered challan %s for consignment %s → %s (v%d)",
                challan_no, consignment_id, key, version)
    return key


@celery_app.task(bind=True, name="src.tasks.challan.render_challan",
                 max_retries=3, default_retry_delay=15, acks_late=True)
def render_challan(self, consignment_id: str) -> str | None:
    try:
        return asyncio.run(_render(UUID(consignment_id)))
    except Exception as exc:
        logger.warning("render_challan failed for %s: %s", consignment_id, exc)
        raise self.retry(exc=exc)
