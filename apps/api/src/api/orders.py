"""Orders API — create-from-quote / manual create / guarded status / patch.

Writes only (dashboard reads orders + order_outstanding directly from Supabase
under RLS). Totals ALWAYS computed server-side (gst.py); numbers via allocate().
Status changes are guarded by the pure transition map (services/order_status).
"""

import logging
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..config import get_settings
from ..database import make_task_session
from ..repositories import order_repo as repo
from ..repositories import payment_repo
from ..repositories import quotation_repo
from ..services import gst, numbering, order_status
from .deps import require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/orders", dependencies=[Depends(require_dashboard_key)])


class OrderItemIn(BaseModel):
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
    unit: str | None = None


class OrderCreate(BaseModel):
    customer_id: UUID
    items: list[OrderItemIn] = Field(min_length=1)
    discount: Decimal = Field(default=Decimal(0), ge=0)
    place_of_supply: str = "GJ"
    salesperson_id: UUID | None = None
    expected_delivery_date: date | None = None
    notes: str | None = None


class StatusPatch(BaseModel):
    status: str
    reason: str | None = None


class OrderPatch(BaseModel):
    expected_delivery_date: date | None = None
    notes: str | None = None


class ScheduleRowIn(BaseModel):
    label: str | None = None
    due_date: date
    amount: Decimal = Field(gt=0)


class ScheduleReplace(BaseModel):
    rows: list[ScheduleRowIn] = Field(default_factory=list)


def _compute(items: list[OrderItemIn], discount: Decimal, place_of_supply: str):
    settings = get_settings()
    lines = [gst.LineInput(qty=it.qty, unit_price=it.unit_price, gst_rate=it.gst_rate) for it in items]
    totals = gst.compute_document(lines, discount, place_of_supply, settings.HOME_STATE)
    order_items = [
        repo.OrderItem(
            description=it.description, qty=it.qty, unit_price=it.unit_price, hsn=it.hsn,
            gst_rate=it.gst_rate, line_total=gst.compute_line(it.qty, it.unit_price).line_total,
            product_id=it.product_id, dimensions=it.dimensions, material=it.material,
            fabric=it.fabric, polish=it.polish, customization=it.customization, unit=it.unit, sort=i,
        )
        for i, it in enumerate(items)
    ]
    return totals, order_items


@router.post("/from-quote/{quotation_id}", status_code=status.HTTP_201_CREATED)
async def create_from_quote(quotation_id: UUID) -> dict:
    settings = get_settings()
    async with make_task_session() as session:
        order_no = await numbering.allocate(session, "ORD")
        order_id = await repo.create_from_quote(
            session, quotation_id, order_no=order_no, advance_pct=settings.DEFAULT_ADVANCE_PCT
        )
        if order_id is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Quotation not found or not approved")
        result = await repo.get_order(session, order_id)
        await quotation_repo.upsert_pipeline_stage(session, result["customer_id"], "order_confirmed")
        await session.commit()
    logger.info("Created order %s from quote %s", order_no, quotation_id)
    return result


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_order(req: OrderCreate) -> dict:
    totals, items = _compute(req.items, req.discount, req.place_of_supply)
    async with make_task_session() as session:
        order_no = await numbering.allocate(session, "ORD")
        order_id = await repo.create_order(
            session, order_no=order_no, customer_id=req.customer_id, totals=totals, items=items,
            salesperson_id=req.salesperson_id, expected_delivery_date=req.expected_delivery_date,
            notes=req.notes,
        )
        result = await repo.get_order(session, order_id)
        await quotation_repo.upsert_pipeline_stage(session, str(req.customer_id), "order_confirmed")
        await session.commit()
    logger.info("Created manual order %s", order_no)
    return result


@router.patch("/{order_id}/status")
async def patch_status(order_id: UUID, req: StatusPatch) -> dict:
    async with make_task_session() as session:
        current = await repo.get_status(session, order_id)
        if current is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        if not order_status.can_transition(current, req.status):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"Illegal transition: {current} → {req.status}")
        if order_status.requires_reason(req.status) and not (req.reason and req.reason.strip()):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"A reason is required to set status '{req.status}'")
        ok = await repo.set_status(
            session, order_id, from_status=current, to_status=req.status,
            reason=req.reason.strip() if req.reason else None,
        )
        if not ok:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Order status changed concurrently — retry")
        await session.commit()
    return {"order_id": str(order_id), "status": req.status}


@router.post("/{order_id}/schedule")
async def set_schedule(order_id: UUID, req: ScheduleReplace) -> dict:
    """Replace an order's unpaid payment schedule (paid rows are preserved)."""
    async with make_task_session() as session:
        if await repo.get_status(session, order_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        rows = [
            payment_repo.ScheduleRow(label=r.label, due_date=r.due_date, amount=r.amount)
            for r in req.rows
        ]
        await payment_repo.replace_schedule(session, order_id, rows)
        await session.commit()
    return {"order_id": str(order_id), "rows": len(req.rows)}


@router.patch("/{order_id}")
async def patch_order(order_id: UUID, req: OrderPatch) -> dict:
    async with make_task_session() as session:
        ok = await repo.patch_order(
            session, order_id, expected_delivery_date=req.expected_delivery_date, notes=req.notes
        )
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        result = await repo.get_order(session, order_id)
        await session.commit()
    return result
