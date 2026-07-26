"""Production repository — module 08 scope: ALLOCATION ONLY.

Stage advancement (`insert_event`, `get_item_stage_state`, `queue_for_workshop`)
belongs to module 09 and is deliberately absent here. 08 ships the allocation
invariant and the reads the allocate page needs.

Raw SQL on an AsyncSession; caller owns the transaction.
"""

from dataclasses import dataclass
from datetime import date
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import audit_repo


@dataclass(frozen=True)
class Allocation:
    assignment_id: str
    order_item_id: str
    workshop_id: str
    due_date: date | None
    current_stage: str | None
    previous_workshop_id: str | None


async def lock_item(session: AsyncSession, order_item_id: UUID) -> dict | None:
    """SELECT ... FOR UPDATE on the order_item row.

    This is the allocation invariant's primary serialisation: it makes the
    deactivate-then-insert pair atomic against a concurrent allocation of the same
    item, so the second caller queues and then produces a clean re-allocation
    instead of racing into two active rows. Same lock discipline as the payments
    over-payment TOCTOU fix (payment_repo.lock_order).
    """
    result = await session.execute(
        text(
            "SELECT oi.id, oi.order_id, oi.current_stage, oi.workshop_id,"
            "       oi.production_done_at, o.status AS order_status, o.customer_id"
            " FROM order_items oi JOIN orders o ON o.id = oi.order_id"
            " WHERE oi.id = :id FOR UPDATE OF oi"
        ),
        {"id": str(order_item_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def first_stage_code(session: AsyncSession) -> str | None:
    result = await session.execute(
        text("SELECT code FROM production_stage_defs WHERE active = true ORDER BY sort LIMIT 1")
    )
    row = result.first()
    return None if row is None else str(row[0])


async def allocate(
    session: AsyncSession,
    *,
    order_item_id: UUID,
    workshop_id: UUID,
    due_date: date | None,
    actor_id: UUID | None,
) -> Allocation:
    """Assign an item to a workshop: retire any prior assignment, insert the new
    one, refresh the denorm, audit it.

    The caller MUST have taken lock_item() first. The partial unique index
    order_item_assignments_one_active is the DB backstop — a caller that reaches
    the INSERT without the lock raises unique_violation, which the API maps to 409
    (we do NOT use ON CONFLICT: the desired outcome is an error, not an upsert, and
    claim_customer() already sets the house precedent of catching the violation
    rather than trusting arbiter inference against a partial index).

    Allocation emits NO production_event and does NOT touch orders.status — the
    status flip happens on the first `done`, per the transition map.
    """
    prior = await session.execute(
        text(
            "UPDATE order_item_assignments SET active = false, deactivated_at = now()"
            " WHERE order_item_id = :item AND active = true"
            " RETURNING id, workshop_id"
        ),
        {"item": str(order_item_id)},
    )
    prior_row = prior.mappings().first()
    previous_workshop_id = str(prior_row["workshop_id"]) if prior_row else None

    inserted = await session.execute(
        text(
            "INSERT INTO order_item_assignments"
            " (order_item_id, workshop_id, due_date, assigned_by, active)"
            " VALUES (:item, :workshop, :due, :actor, true) RETURNING id"
        ),
        {
            "item": str(order_item_id), "workshop": str(workshop_id), "due": due_date,
            "actor": str(actor_id) if actor_id else None,
        },
    )
    assignment_id = str(inserted.scalar_one())

    # First-stage initialisation. current_stage is set HERE, never by the event
    # trigger: picking a starting stage is a business decision, not an event
    # consequence (0024 header). coalesce so a re-allocation mid-production never
    # rewinds an item that is already three stages in.
    #
    # order_items.workshop_id is deliberately NOT written here — the
    # order_item_assignments_sync_denorm trigger owns it, so there is exactly one
    # writer and the denorm cannot drift from the active assignment row.
    updated = await session.execute(
        text(
            "UPDATE order_items SET"
            "   current_stage    = coalesce(current_stage,"
            "       (SELECT code FROM production_stage_defs WHERE active = true"
            "         ORDER BY sort LIMIT 1)),"
            "   current_stage_at = coalesce(current_stage_at, now())"
            " WHERE id = :item RETURNING current_stage"
        ),
        {"item": str(order_item_id)},
    )
    current_stage = updated.scalar_one_or_none()

    await audit_repo.record(
        session,
        entity="order_item_assignments",
        entity_id=assignment_id,
        action="allocate",
        actor=actor_id,
        payload={
            "order_item_id": str(order_item_id),
            "workshop_id": str(workshop_id),
            "prior_workshop_id": previous_workshop_id,
            "due_date": due_date.isoformat() if due_date else None,
        },
    )

    return Allocation(
        assignment_id=assignment_id,
        order_item_id=str(order_item_id),
        workshop_id=str(workshop_id),
        due_date=due_date,
        current_stage=str(current_stage) if current_stage else None,
        previous_workshop_id=previous_workshop_id,
    )


async def active_assignment(session: AsyncSession, order_item_id: UUID) -> dict | None:
    result = await session.execute(
        text(
            "SELECT id, order_item_id, workshop_id, due_date, assigned_by, created_at"
            " FROM order_item_assignments WHERE order_item_id = :item AND active = true"
        ),
        {"item": str(order_item_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def unallocated_items(
    session: AsyncSession, *, salesperson_id: str | None = None, limit: int = 200
) -> list[dict]:
    """Items of confirmed/in-production orders with no workshop yet — the allocate
    page's queue. Served by order_items_unallocated_idx.

    `salesperson_id` scopes the queue to that person's assigned customers. It is
    passed for the `salesperson` role and omitted for owner/admin, mirroring the
    write path: allocate() already refuses an unassigned customer, so an unscoped
    read would list customer names and order contents a salesperson cannot act on.
    """
    result = await session.execute(
        text(
            "SELECT oi.id, oi.description, oi.qty, oi.unit, oi.dimensions, oi.material,"
            "       oi.order_id, o.order_no, o.expected_delivery_date, o.status,"
            "       c.id AS customer_id, c.name AS customer_name"
            " FROM order_items oi"
            " JOIN orders o ON o.id = oi.order_id"
            " JOIN customers c ON c.id = o.customer_id"
            " WHERE oi.workshop_id IS NULL AND o.status IN ('confirmed', 'in_production')"
            "   AND (:sp IS NULL OR EXISTS ("
            "        SELECT 1 FROM customer_assignments ca"
            "         WHERE ca.customer_id = o.customer_id AND ca.active = true"
            "           AND ca.salesperson_id = cast(:sp as uuid)))"
            " ORDER BY o.expected_delivery_date NULLS LAST, o.created_at, oi.sort"
            " LIMIT :limit"
        ),
        {"limit": limit, "sp": salesperson_id},
    )
    return [dict(m) for m in result.mappings().all()]
