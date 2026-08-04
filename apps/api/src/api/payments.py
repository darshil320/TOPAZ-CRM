"""Payments API — record immutable payments; edit an order's schedule.

Guards (money — security-reviewed):
  - amount > 0 (Pydantic).
  - refund kind → recorded_by must be owner/admin (accounts cannot refund).
  - over-payment (paid + amount > grand_total) → 409 unless override=true AND
    recorded_by is owner/admin.
No PUT/DELETE on payments, ever (DB trigger enforces immutability too).
The caller's salesperson id (recorded_by) is supplied by the authenticated
dashboard server action; the API resolves its role from the DB (never trusts a
client-sent role). RLS additionally restricts inserts to accounts/owner/admin.
"""

import logging
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..config import get_settings
from ..database import get_api_session
from ..repositories import document_repo
from ..repositories import payment_repo as repo
from ..services import numbering, storage
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/payments", dependencies=[Depends(require_dashboard_key)])

# Roles allowed to record ANY payment. The FastAPI layer is the whole authz
# boundary here — the service-role DB connection bypasses RLS, so the RLS
# pay_insert policy (accounts/owner/admin) must be re-enforced in code
# (security-review CRITICAL-1).
_PAYMENT_ROLES = {"owner", "admin", "accounts"}
# Roles allowed to refund + to override the over-payment guard.
_ELEVATED_ROLES = {"owner", "admin"}


class PaymentCreate(BaseModel):
    order_id: UUID
    kind: str = Field(pattern="^(advance|stage|final|refund)$")
    amount: Decimal = Field(gt=0)
    mode: str = Field(pattern="^(cash|upi|bank|cheque|card)$")
    paid_at: datetime
    reference: str | None = None
    notes: str | None = None
    # Owner/admin may knowingly accept a payment beyond the order total.
    override_overpay: bool = False


@router.get("/{payment_id}/receipt-url")
async def receipt_url(payment_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Return a short-lived signed URL for a payment's receipt PDF.

    The receipt lives in the private `documents` bucket, so the browser can't
    fetch it directly — this issues a time-limited signed URL after checking the
    caller may read the payment's customer (owner/admin/accounts, or the assigned
    salesperson). 404 if the receipt hasn't been rendered yet.
    """
    settings = get_settings()
    async with get_api_session() as session:
        row = await session.execute(
            text("SELECT customer_id FROM payments WHERE id = :id"), {"id": str(payment_id)}
        )
        customer_id = row.scalar_one_or_none()
        if customer_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
        caller = await authz.resolve_caller(session, caller_uid)
        await authz.assert_can_read_customer(session, caller, str(customer_id))
        key = await document_repo.latest_storage_key(session, "payment", payment_id, "receipt_pdf")
    if key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Receipt not generated yet")
    try:
        url = await storage.signed_url_async(settings.DOCUMENTS_BUCKET, key)
    except storage.StorageError as exc:
        logger.error("Receipt URL sign failed for payment %s: %s", payment_id, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not generate receipt link") from exc
    return {"url": url}


@router.post("", status_code=status.HTTP_201_CREATED)
async def record_payment(req: PaymentCreate, caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        customer_id = await repo.order_customer_id(session, req.order_id)
        if customer_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

        # Identity + role come from the verified JWT, never the request body
        # (security-review HIGH-3).
        caller = await authz.resolve_caller(session, caller_uid)
        role = caller.role
        recorded_by = UUID(caller.salesperson_id)
        if role not in _PAYMENT_ROLES:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Only accounts/owner/admin may record payments")
        elevated = role in _ELEVATED_ROLES

        if req.kind == "refund" and not elevated:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Only owner/admin can record a refund")

        # Lock the order row so the over-payment check + insert are atomic against
        # concurrent payments (security-review CRITICAL-2, TOCTOU).
        await repo.lock_order(session, req.order_id)

        # Over-payment guard (non-refunds only; refunds reduce paid).
        if req.kind != "refund":
            totals = await repo.order_totals(session, req.order_id)
            if totals is not None:
                grand_total, paid = totals
                if paid + req.amount > grand_total and not (req.override_overpay and elevated):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            f"Payment exceeds outstanding "
                            f"(outstanding {grand_total - paid}, attempted {req.amount})"
                        ),
                    )

        receipt_no = await numbering.allocate(session, "RCP")
        payment_id = await repo.record_payment(
            session, receipt_no=receipt_no, order_id=req.order_id, customer_id=customer_id,
            kind=req.kind, amount=req.amount, mode=req.mode, paid_at=req.paid_at,
            reference=req.reference, recorded_by=recorded_by, notes=req.notes,
        )
        if req.kind != "refund":
            await repo.mark_earliest_schedule_paid(session, req.order_id, req.amount)
        await session.commit()

    # Receipt PDF (+ optional customer WhatsApp) in the worker. The payment is
    # already committed; a broker hiccup here must NOT surface as an error, or the
    # salesperson may resubmit and double-record (no idempotency key on POST).
    # A missing receipt PDF can be backfilled — a duplicate payment cannot.
    try:
        from ..tasks.receipts import render_receipt
        render_receipt.delay(str(payment_id))
    except Exception:
        logger.warning("Receipt enqueue failed for payment %s — backfill later", payment_id, exc_info=True)
    logger.info("Recorded payment %s (%s %s) on order %s", receipt_no, req.kind, req.amount, req.order_id)
    return {"id": str(payment_id), "receipt_no": receipt_no}
