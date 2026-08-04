"""Document API — delivery challans (0037, per-consignment since 0040).

    GET  /api/documents/challan/delivery/{delivery_id}   the run's recipients
         200 {consignments: [{id, customer_id, customer_name, challan_no, item_count}]}
         404 unknown delivery
    POST /api/documents/challan/{consignment_id}         enqueue the render
         202 {status: "queued", challan_no}   — challan_no is null on the first call,
                                                allocated by the worker
         403 caller may not act on this customer's order
         404 unknown consignment
    GET  /api/documents/challan/{consignment_id}         signed URL for the rendered PDF
         200 {url, challan_no, version}
         404 not generated yet

WHY THE UNIT IS A CONSIGNMENT: a delivery can carry goods for more than one customer
(0040), and each recipient signs their own paper. One challan per `(delivery, customer)` is
therefore the only grain that produces correct documents — and it keeps this router's
authorization a ONE-customer check, because a consignment has exactly one customer by
construction. The `delivery/{id}` route above exists so the dashboard can discover how many
documents a given run has.

Mirrors `GET /api/payments/{id}/receipt-url`: the bytes live in the PRIVATE `documents`
bucket, so the browser cannot fetch them and this route issues a short-lived signed URL
after the read check.

WHY A SEPARATE ROUTER and not a delivery one: there is no deliveries API module — the
dashboard writes deliveries through `schedule_delivery(jsonb)` under its own RLS
(0033/0039/0040). This router exists purely because a signed URL needs the service-role key,
which must never reach a browser.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text

from ..config import get_settings
from ..database import get_api_session
from ..repositories import delivery_repo, document_repo
from ..services import storage
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", dependencies=[Depends(require_dashboard_key)])

# Duplicated from tasks/challan.py rather than imported: importing that module at API import
# time would drag Celery, Playwright and the Storage client into the web process, which the
# import-light rule exists to prevent (the task itself is imported lazily inside the POST).
# tests/test_challan_entities.py pins the two copies together.
ENTITY = "delivery_consignment"
LEGACY_ENTITY = "delivery"
KIND = "challan_pdf"


async def _consignment_or_404(session, consignment_id: UUID) -> dict:
    found = await delivery_repo.consignment_or_none(session, consignment_id)
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Consignment not found")
    return found


@router.get("/challan/delivery/{delivery_id}")
async def delivery_consignments(
    delivery_id: UUID, caller_uid: str = Depends(get_caller_uid)
) -> dict:
    """Who is receiving goods on this run, and whether each one's challan exists yet.

    Every recipient is checked individually: a mixed-customer run must not leak the second
    customer's name to a salesperson who only owns the first. An unreadable recipient is
    OMITTED rather than 403'd — the caller is legitimately entitled to their own row.
    """
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        exists = await session.execute(
            text("SELECT 1 FROM deliveries WHERE id = :id"), {"id": str(delivery_id)}
        )
        if exists.first() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Delivery not found")

        rows = await delivery_repo.consignments_for_delivery(session, delivery_id)
        visible = []
        for row in rows:
            try:
                await authz.assert_can_read_customer(session, caller, str(row["customer_id"]))
            except HTTPException:
                continue
            visible.append({
                "id": str(row["id"]),
                "customer_id": str(row["customer_id"]),
                "customer_name": row["customer_name"],
                "challan_no": row["challan_no"],
                "item_count": row["item_count"],
            })

    return {"delivery_id": str(delivery_id), "consignments": visible}


@router.post("/challan/{consignment_id}", status_code=status.HTTP_202_ACCEPTED)
async def generate_challan(
    consignment_id: UUID, caller_uid: str = Depends(get_caller_uid)
) -> dict:
    """Queue a challan render.

    202 rather than 200: rendering runs a headless browser and takes seconds, so the UI
    polls the GET below. Re-generating is allowed and idempotent in the way that matters —
    the challan NUMBER is allocated once and reused; only `documents.version` moves.
    """
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        consignment = await _consignment_or_404(session, consignment_id)
        # Same boundary as scheduling the delivery itself (0040's schedule_delivery):
        # owner/admin, or the salesperson who owns the customer. A challan lists the
        # customer's goods and their outstanding balance.
        await authz.assert_can_write_customer(session, caller, str(consignment["customer_id"]))

    try:
        from ..tasks.challan import render_challan

        render_challan.delay(str(consignment_id))
    except Exception as exc:  # noqa: BLE001 — a broker hiccup is not a 500 for the operator
        logger.warning("Could not enqueue challan render for %s: %s", consignment_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not start the challan render — try again in a moment",
        ) from exc

    logger.info("Challan render queued for consignment %s by %s",
                consignment_id, caller.salesperson_id)
    return {"status": "queued", "consignment_id": str(consignment_id),
            "delivery_id": str(consignment["delivery_id"]),
            "challan_no": consignment["challan_no"]}


@router.get("/challan/{consignment_id}")
async def challan_url(
    consignment_id: UUID, caller_uid: str = Depends(get_caller_uid)
) -> dict:
    """A short-lived signed URL for this consignment's challan PDF."""
    settings = get_settings()
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        consignment = await _consignment_or_404(session, consignment_id)
        # READ is wider than write on purpose: accounts reconcile challans against
        # invoices, and the same rule already governs receipts (assert_can_read_customer).
        await authz.assert_can_read_customer(session, caller, str(consignment["customer_id"]))

        key = await document_repo.latest_storage_key(session, ENTITY, consignment_id, KIND)
        version = await document_repo.next_version(session, ENTITY, consignment_id) - 1
        if key is None:
            # A challan rendered before 0040 was filed against the DELIVERY. 0040 gave every
            # legacy delivery exactly one consignment carrying its challan number, so this
            # fallback is what keeps those PDFs downloadable instead of silently 404ing and
            # inviting somebody to regenerate a document that already exists on paper.
            legacy_id = consignment["delivery_id"]
            key = await document_repo.latest_storage_key(
                session, LEGACY_ENTITY, legacy_id, KIND
            )
            version = await document_repo.next_version(
                session, LEGACY_ENTITY, legacy_id
            ) - 1

    if key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Challan not generated yet")
    try:
        url = await storage.signed_url_async(settings.DOCUMENTS_BUCKET, key)
    except storage.StorageError as exc:
        logger.error("Challan URL sign failed for consignment %s: %s", consignment_id, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not generate the challan link") from exc
    return {"url": url, "challan_no": consignment["challan_no"], "version": version}
