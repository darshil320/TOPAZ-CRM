"""Quotations API — draft create / update / revise / soft-delete.

Writes only (dashboard reads quotations directly from Supabase under RLS, §19-G).
Totals are ALWAYS computed server-side from the line items (gst.py); the client
never supplies money. Numbers come from the atomic allocator (numbering.py).
Send + public approval endpoints live in module 03.
"""

import logging
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..config import get_settings
from ..database import get_api_session
from ..repositories import quotation_repo as repo
from ..services import gst, numbering
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/quotations", dependencies=[Depends(require_dashboard_key)])


# ─── request models ───────────────────────────────────────────────────────────

class QuoteItemIn(BaseModel):
    description: str = Field(min_length=1)
    qty: Decimal = Field(gt=0)
    unit_price: Decimal = Field(ge=0)
    hsn: str = Field(min_length=1)
    gst_rate: Decimal = Field(ge=0, le=100)
    product_id: UUID | None = None
    dimensions: str | None = None
    material: str | None = None
    fabric: str | None = None
    polish: str | None = None
    customization: str | None = None
    spec_notes: str | None = None
    unit: str | None = None


class QuoteCreate(BaseModel):
    customer_id: UUID
    items: list[QuoteItemIn] = Field(min_length=1)
    discount: Decimal = Field(default=Decimal(0), ge=0)
    place_of_supply: str = "GJ"
    valid_until: date | None = None
    terms: str | None = None
    notes: str | None = None
    # (created_by is derived from the verified caller token, not the body.)


class QuoteUpdate(BaseModel):
    items: list[QuoteItemIn] = Field(min_length=1)
    discount: Decimal = Field(default=Decimal(0), ge=0)
    place_of_supply: str = "GJ"
    valid_until: date | None = None
    terms: str | None = None
    notes: str | None = None


# ─── helpers ────────────────────────────────────────────────────────────────

def _compute(items: list[QuoteItemIn], discount: Decimal, place_of_supply: str):
    """Server-side totals + per-line totals. Never trust client money."""
    settings = get_settings()
    lines = [gst.LineInput(qty=it.qty, unit_price=it.unit_price, gst_rate=it.gst_rate) for it in items]
    totals = gst.compute_document(lines, discount, place_of_supply, settings.HOME_STATE)
    repo_items = [
        repo.QuoteItem(
            description=it.description, qty=it.qty, unit_price=it.unit_price, hsn=it.hsn,
            gst_rate=it.gst_rate, line_total=gst.compute_line(it.qty, it.unit_price).line_total,
            product_id=it.product_id, dimensions=it.dimensions, material=it.material,
            fabric=it.fabric, polish=it.polish, customization=it.customization, spec_notes=it.spec_notes,
            unit=it.unit, sort=i,
        )
        for i, it in enumerate(items)
    ]
    return totals, repo_items


def _default_valid_until(supplied: date | None) -> date:
    if supplied:
        return supplied
    return date.today() + timedelta(days=get_settings().QUOTE_VALIDITY_DAYS)


# ─── endpoints ────────────────────────────────────────────────────────────────

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_quotation(req: QuoteCreate, caller_uid: str = Depends(get_caller_uid)) -> dict:
    totals, items = _compute(req.items, req.discount, req.place_of_supply)
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        await authz.assert_can_write_customer(session, caller, str(req.customer_id))
        quote_no = await numbering.allocate(session, "QTN")
        quotation_id = await repo.create_quotation(
            session, quote_no=quote_no, customer_id=req.customer_id, totals=totals, items=items,
            place_of_supply=req.place_of_supply, valid_until=_default_valid_until(req.valid_until),
            terms=req.terms, notes=req.notes, created_by=UUID(caller.salesperson_id),
        )
        result = await repo.get_quotation(session, quotation_id)
        await session.commit()
    logger.info("Created quotation %s (%s)", quote_no, quotation_id)
    return result


async def _authorize(session, caller_uid: str, quotation_id: UUID) -> None:
    """Resolve the caller and assert they may write this quotation's customer.
    404 if the quotation doesn't exist."""
    caller = await authz.resolve_caller(session, caller_uid)
    customer_id = await repo.quotation_customer_id(session, quotation_id)
    if customer_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    await authz.assert_can_write_customer(session, caller, customer_id)


@router.put("/{quotation_id}")
async def update_quotation(quotation_id: UUID, req: QuoteUpdate,
                           caller_uid: str = Depends(get_caller_uid)) -> dict:
    totals, items = _compute(req.items, req.discount, req.place_of_supply)
    async with get_api_session() as session:
        await _authorize(session, caller_uid, quotation_id)
        ok = await repo.update_draft(
            session, quotation_id, totals=totals, items=items,
            place_of_supply=req.place_of_supply, valid_until=req.valid_until,
            terms=req.terms, notes=req.notes,
        )
        if not ok:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Only draft quotations can be edited")
        result = await repo.get_quotation(session, quotation_id)
        await session.commit()
    return result


@router.post("/{quotation_id}/revise", status_code=status.HTTP_201_CREATED)
async def revise_quotation(quotation_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        await _authorize(session, caller_uid, quotation_id)
        new_quote_no = await numbering.allocate(session, "QTN")
        new_id = await repo.clone_for_revision(session, quotation_id, new_quote_no=new_quote_no)
        if new_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found")
        result = await repo.get_quotation(session, new_id)
        await session.commit()
    logger.info("Revised quotation %s -> %s (%s)", quotation_id, new_quote_no, new_id)
    return result


@router.delete("/{quotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_quotation(quotation_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> None:
    async with get_api_session() as session:
        await _authorize(session, caller_uid, quotation_id)
        ok = await repo.soft_delete_draft(session, quotation_id)
        if not ok:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Only draft quotations can be deleted")
        await session.commit()


@router.post("/{quotation_id}/send", status_code=status.HTTP_202_ACCEPTED)
async def send_quotation(quotation_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Render (if needed) + WhatsApp the quote to the customer, advancing it to
    'sent'. Draft-only; the render + send + status flip happen in the worker."""
    async with get_api_session() as session:
        await _authorize(session, caller_uid, quotation_id)
        current = await repo.get_status(session, quotation_id)
    if current is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    if current != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Only draft quotations can be sent (status: {current})")
    from ..tasks.quotes import send_quotation as send_task
    send_task.delay(str(quotation_id))
    logger.info("Queued send for quotation %s", quotation_id)
    return {"quotation_id": str(quotation_id), "queued": True}
