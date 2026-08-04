"""Document API — delivery challans (0037).

    POST /api/documents/challan/{delivery_id}     enqueue the render
         202 {status: "queued", challan_no}   — challan_no is null on the first call,
                                                allocated by the worker
         403 caller may not act on this customer's order
         404 unknown delivery
    GET  /api/documents/challan/{delivery_id}     signed URL for the rendered PDF
         200 {url, challan_no, version}
         404 not generated yet

Mirrors `GET /api/payments/{id}/receipt-url`: the bytes live in the PRIVATE `documents`
bucket, so the browser cannot fetch them and this route issues a short-lived signed URL
after the read check.

WHY A SEPARATE ROUTER and not a delivery one: there is no deliveries API module — the
dashboard writes `deliveries` directly under RLS (0033/0039). This router exists purely
because a signed URL needs the service-role key, which must never reach a browser.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text

from ..config import get_settings
from ..database import make_task_session
from ..repositories import document_repo
from ..services import storage
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", dependencies=[Depends(require_dashboard_key)])

_ENTITY = "delivery"
_KIND = "challan_pdf"


async def _delivery_or_404(session, delivery_id: UUID) -> dict:
    row = await session.execute(
        text(
            "SELECT d.id, d.challan_no, d.status, d.order_id, o.customer_id"
            " FROM deliveries d JOIN orders o ON o.id = d.order_id"
            " WHERE d.id = :id"
        ),
        {"id": str(delivery_id)},
    )
    found = row.mappings().first()
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found")
    return dict(found)


@router.post("/challan/{delivery_id}", status_code=status.HTTP_202_ACCEPTED)
async def generate_challan(delivery_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Queue a challan render.

    202 rather than 200: rendering runs a headless browser and takes seconds, so the UI
    polls the GET below. Re-generating is allowed and idempotent in the way that matters —
    the challan NUMBER is allocated once and reused; only `documents.version` moves.
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        delivery = await _delivery_or_404(session, delivery_id)
        # Same boundary as scheduling the delivery itself (0033's deliveries_insert):
        # owner/admin, or the salesperson who owns the customer. A challan lists the
        # customer's goods and, when CHALLAN_WITH_VALUES is on, their prices.
        await authz.assert_can_write_customer(session, caller, str(delivery["customer_id"]))

    try:
        from ..tasks.challan import render_challan

        render_challan.delay(str(delivery_id))
    except Exception as exc:  # noqa: BLE001 — a broker hiccup is not a 500 for the operator
        logger.warning("Could not enqueue challan render for %s: %s", delivery_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not start the challan render — try again in a moment",
        ) from exc

    logger.info("Challan render queued for delivery %s by %s", delivery_id, caller.salesperson_id)
    return {"status": "queued", "delivery_id": str(delivery_id),
            "challan_no": delivery["challan_no"]}


@router.get("/challan/{delivery_id}")
async def challan_url(delivery_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """A short-lived signed URL for the delivery's challan PDF."""
    settings = get_settings()
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        delivery = await _delivery_or_404(session, delivery_id)
        # READ is wider than write on purpose: accounts reconcile challans against
        # invoices, and the same rule already governs receipts (assert_can_read_customer).
        await authz.assert_can_read_customer(session, caller, str(delivery["customer_id"]))
        key = await document_repo.latest_storage_key(session, _ENTITY, delivery_id, _KIND)
        version = await document_repo.next_version(session, _ENTITY, delivery_id) - 1

    if key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Challan not generated yet")
    try:
        url = storage.signed_url(settings.DOCUMENTS_BUCKET, key)
    except storage.StorageError as exc:
        logger.error("Challan URL sign failed for delivery %s: %s", delivery_id, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not generate the challan link") from exc
    return {"url": url, "challan_no": delivery["challan_no"], "version": version}
