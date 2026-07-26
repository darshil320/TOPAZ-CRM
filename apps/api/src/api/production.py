"""Production API — module 08 scope: ALLOCATION ONLY.

The stage machine (advance / block / unblock / override-stage / my-queue) is module
09 and is deliberately not here. 08 establishes the invariant everything downstream
depends on: an order item has AT MOST ONE active workshop assignment.

Contract (frozen — the dashboard's allocate page and module 09 build on it):

    POST /api/production/allocate
      req  {order_item_id: uuid, workshop_id: uuid, due_date?: YYYY-MM-DD}
      200  {assignment_id, order_item_id, workshop_id, due_date,
            current_stage, previous_workshop_id}
      403  caller may not allocate this order's item
      404  unknown item / unknown workshop
      409  workshop inactive · order status not confirmed|in_production ·
           item already finished · concurrent allocation
      422  due_date in the past

    GET  /api/production/unallocated
      200  {items: [...]}   confirmed/in-production items with no workshop yet

Concurrency: lock_item() (SELECT ... FOR UPDATE) serialises two allocations of the
same item; the partial unique index is the backstop and surfaces as 409.
"""

import logging
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from ..database import make_task_session
from ..repositories import production_repo as repo
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/production", dependencies=[Depends(require_dashboard_key)])

# Re-allocation mid-production is legitimate (a workshop falls behind); a cancelled,
# delivered or closed order is not.
_ALLOCATABLE_ORDER_STATUSES = {"confirmed", "in_production"}


class AllocateRequest(BaseModel):
    order_item_id: UUID
    workshop_id: UUID
    due_date: date | None = None


async def _active_workshop(session, workshop_id: UUID) -> None:
    row = await session.execute(
        text("SELECT active FROM workshops WHERE id = :id"), {"id": str(workshop_id)}
    )
    found = row.first()
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workshop not found")
    if not found[0]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Workshop is inactive")


@router.get("/unallocated")
async def unallocated(caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        if caller.role not in ("owner", "admin", "salesperson"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Your role cannot allocate production work")
        items = await repo.unallocated_items(session)
    return {"items": items}


@router.post("/allocate")
async def allocate(req: AllocateRequest, caller_uid: str = Depends(get_caller_uid)) -> dict:
    if req.due_date is not None and req.due_date < date.today():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Due date is in the past")

    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        # A workshop manager must never self-allocate work; accounts/delivery have
        # no production role at all.
        if caller.role not in ("owner", "admin", "salesperson"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Your role cannot allocate production work")

        await _active_workshop(session, req.workshop_id)

        item = await repo.lock_item(session, req.order_item_id)
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order item not found")
        await authz.assert_can_write_customer(session, caller, str(item["customer_id"]))

        if item["order_status"] not in _ALLOCATABLE_ORDER_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot allocate an order with status '{item['order_status']}'",
            )
        if item["production_done_at"] is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="This item has already finished production")

        try:
            result = await repo.allocate(
                session, order_item_id=req.order_item_id, workshop_id=req.workshop_id,
                due_date=req.due_date, actor_id=UUID(caller.salesperson_id),
            )
        except IntegrityError as exc:
            # order_item_assignments_one_active fired: someone allocated the same
            # item between our lock and this insert (only reachable if the lock was
            # bypassed). Never an upsert — the caller must see stale state and refetch.
            logger.info("Concurrent allocation on item %s: %s", req.order_item_id, exc)
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Item was allocated concurrently — refresh and retry") from exc
        await session.commit()

    logger.info("Allocated item %s to workshop %s (was %s)",
                req.order_item_id, req.workshop_id, result.previous_workshop_id)
    return {
        "assignment_id": result.assignment_id,
        "order_item_id": result.order_item_id,
        "workshop_id": result.workshop_id,
        "due_date": result.due_date.isoformat() if result.due_date else None,
        "current_stage": result.current_stage,
        "previous_workshop_id": result.previous_workshop_id,
    }
