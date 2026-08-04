"""Celery task: render a delivery challan PDF and file it (0037).

Mirrors tasks/receipts.py exactly — gather → render → Storage → `documents` row — with
two differences that matter:

  1. **The number is allocated ONCE.** `deliveries.challan_no` is UNIQUE; a re-render
     reuses it and bumps `documents.version`. A challan number is a statutory reference a
     transport officer may quote back weeks later, so it must not move because somebody
     regenerated the PDF.
  2. **The lines come from `delivery_items`, not from the order.** A partial delivery's
     challan lists what is on THAT lorry (0039). Reading the order's items would put goods
     on the paper that are still in a workshop.

The layout is the client's own (sample "T.F 66") — a PRODUCT / RECEIVED tick table, a
Balance Amount line, and two signature blocks. It carries no HSN, no rates and no GST, so
nothing here computes tax.

Layout lives entirely in services/challan_html.py + templates/challan.html — see that
module's header for the data contract and the two fields still to confirm with the client.
"""

import asyncio
import logging
from uuid import UUID

from sqlalchemy import text

from .celery_app import celery_app
from ..config import get_settings
from ..database import make_task_session
from ..repositories import document_repo
from ..services import challan_html, numbering
from ..services import pdf as pdf_engine
from ..services.storage import upload_bytes

logger = logging.getLogger(__name__)

_SERIES = "CHL"


def _slug(challan_no: str) -> str:
    """A Storage-key-safe form of a human challan number. Pure."""
    return "".join(ch if ch.isalnum() else "-" for ch in challan_no).strip("-").replace("--", "-")


async def _ensure_challan_no(session, delivery_id: UUID) -> str | None:
    """Allocate the challan number if this delivery has none yet; else return the existing.

    The UPDATE is guarded by `challan_no IS NULL` and returns the row, so two concurrent
    "Generate challan" taps cannot produce two numbers for one delivery — the loser reads
    back the winner's.
    """
    existing = await session.execute(
        text("SELECT challan_no FROM deliveries WHERE id = :id"), {"id": str(delivery_id)}
    )
    row = existing.first()
    if row is None:
        return None
    if row[0]:
        return str(row[0])

    # Continuous counter, their prefix: "T.F 66". A fiscal-year series would restart every
    # April and duplicate numbers they have already issued by hand (0037's ops note).
    challan_no = await numbering.allocate_continuous(
        session, _SERIES, prefix=get_settings().CHALLAN_NO_PREFIX
    )
    claimed = await session.execute(
        text(
            "UPDATE deliveries SET challan_no = :no, updated_at = now()"
            " WHERE id = :id AND challan_no IS NULL RETURNING challan_no"
        ),
        {"no": challan_no, "id": str(delivery_id)},
    )
    won = claimed.first()
    if won is not None:
        return str(won[0])

    # Lost the race. The allocated number is simply skipped — a gap in a challan series
    # is acceptable (and normal); two challans sharing a number is not.
    logger.info("Challan number %s skipped — delivery %s was numbered concurrently",
                challan_no, delivery_id)
    reread = await session.execute(
        text("SELECT challan_no FROM deliveries WHERE id = :id"), {"id": str(delivery_id)}
    )
    again = reread.first()
    return str(again[0]) if again and again[0] else None


async def _gather(session, delivery_id: UUID) -> dict | None:
    """Everything the layout needs, in the shape services/challan_html documents.

    Only what their format actually prints is read. No HSN, no rates, no tax — their
    challan has none, and selecting money we do not print would be an invitation to
    print it.
    """
    head = (await session.execute(
        text(
            "SELECT d.id, d.challan_no, d.scheduled_date, d.vehicle_no,"
            "       d.notes, d.delivery_address, d.delivery_rent, d.dp_code, d.order_id,"
            "       o.order_no,"
            "       c.name AS customer_name, c.phone AS customer_phone,"
            "       sp.name AS driver_name, sp.whatsapp AS driver_phone,"
            # The "Balance Amount" line. Computed, never stored: it is a live figure the
            # driver may collect against, so a stale copy on the paperwork is worse than
            # no figure. Refunds are negative payments, so a plain SUM is correct.
            "       o.grand_total - coalesce("
            "           (SELECT sum(p.amount) FROM payments p WHERE p.order_id = o.id), 0"
            "       ) AS balance_due"
            " FROM deliveries d"
            " JOIN orders o ON o.id = d.order_id"
            " JOIN customers c ON c.id = o.customer_id"
            " LEFT JOIN salespersons sp ON sp.id = d.driver_salesperson_id"
            " WHERE d.id = :id"
        ),
        {"id": str(delivery_id)},
    )).mappings().first()
    if head is None:
        return None

    # THIS RUN's goods — one tick-box row each. A delivery with no item rows is a pre-0039
    # record meaning "the whole order", so fall back to the order's lines rather than
    # printing an empty table.
    lines = (await session.execute(
        text(
            "SELECT oi.description, oi.qty"
            " FROM delivery_items di"
            " JOIN order_items oi ON oi.id = di.order_item_id"
            " WHERE di.delivery_id = :id"
            " ORDER BY oi.sort"
        ),
        {"id": str(delivery_id)},
    )).mappings().all()
    if not lines:
        logger.info("Delivery %s has no item lines — printing the whole order (pre-0039)",
                    delivery_id)
        lines = (await session.execute(
            text("SELECT description, qty FROM order_items WHERE order_id = :oid ORDER BY sort"),
            {"oid": str(head["order_id"])},
        )).mappings().all()

    return {
        "challan_no": head["challan_no"],
        "challan_date": head["scheduled_date"],
        "dp_code": head["dp_code"],
        "balance_due": head["balance_due"],
        "customer": {
            "name": head["customer_name"],
            # Their ADDRESS line is the SHIP-TO, which is the delivery's, not the
            # customer record's (`customers` has no address column at all — 0002).
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
        "items": [dict(line) for line in lines],
    }


async def _render(delivery_id: UUID) -> str | None:
    settings = get_settings()
    async with make_task_session() as session:
        challan_no = await _ensure_challan_no(session, delivery_id)
        if challan_no is None:
            logger.error("Delivery %s not found — cannot render a challan", delivery_id)
            return None
        # Commit the number before the (slow, fallible) render: if Playwright dies, the
        # retry must reuse this number rather than burn another one.
        await session.commit()

        challan = await _gather(session, delivery_id)
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

        version = await document_repo.next_version(session, "delivery", delivery_id)
        await document_repo.insert_document(
            session, kind="challan_pdf", entity_type="delivery", entity_id=delivery_id,
            storage_key=key, version=version,
        )
        await session.commit()

    logger.info("Rendered challan %s for delivery %s → %s (v%d)",
                challan_no, delivery_id, key, version)
    return key


@celery_app.task(bind=True, name="src.tasks.challan.render_challan",
                 max_retries=3, default_retry_delay=15, acks_late=True)
def render_challan(self, delivery_id: str) -> str | None:
    try:
        return asyncio.run(_render(UUID(delivery_id)))
    except Exception as exc:
        logger.warning("render_challan failed for %s: %s", delivery_id, exc)
        raise self.retry(exc=exc)
