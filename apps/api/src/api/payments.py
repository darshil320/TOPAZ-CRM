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

from ..config import get_settings
from ..database import make_task_session
from ..repositories import payment_repo as repo
from ..services import numbering
from .deps import require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/payments", dependencies=[Depends(require_dashboard_key)])

_ELEVATED_ROLES = {"owner", "admin"}


class PaymentCreate(BaseModel):
    order_id: UUID
    kind: str = Field(pattern="^(advance|stage|final|refund)$")
    amount: Decimal = Field(gt=0)
    mode: str = Field(pattern="^(cash|upi|bank|cheque|card)$")
    paid_at: datetime
    reference: str | None = None
    notes: str | None = None
    recorded_by: UUID
    # Owner/admin may knowingly accept a payment beyond the order total.
    override_overpay: bool = False


@router.post("", status_code=status.HTTP_201_CREATED)
async def record_payment(req: PaymentCreate) -> dict:
    async with make_task_session() as session:
        customer_id = await repo.order_customer_id(session, req.order_id)
        if customer_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

        role = await repo.salesperson_role(session, req.recorded_by)
        if role is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unknown recorder")
        elevated = role in _ELEVATED_ROLES

        if req.kind == "refund" and not elevated:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Only owner/admin can record a refund")

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
            reference=req.reference, recorded_by=req.recorded_by, notes=req.notes,
        )
        if req.kind != "refund":
            await repo.mark_earliest_schedule_paid(session, req.order_id, req.amount)
        await session.commit()

    # Receipt PDF (+ optional customer WhatsApp) in the worker.
    from ..tasks.receipts import render_receipt
    render_receipt.delay(str(payment_id))
    logger.info("Recorded payment %s (%s %s) on order %s", receipt_no, req.kind, req.amount, req.order_id)
    return {"id": str(payment_id), "receipt_no": receipt_no}
