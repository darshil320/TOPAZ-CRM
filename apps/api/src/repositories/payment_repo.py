"""Payment repository — INSERT-ONLY. Payments are immutable (DB trigger blocks
UPDATE/DELETE for everyone, incl. service role); the only correction is a
'refund' reversal row. Schedules are mutable. Money as Decimal (PLAN.md dec. 1).
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class ScheduleRow:
    label: str | None
    due_date: date
    amount: Decimal


async def order_customer_id(session: AsyncSession, order_id: UUID) -> str | None:
    result = await session.execute(
        text("SELECT customer_id FROM orders WHERE id = :id"), {"id": str(order_id)}
    )
    row = result.first()
    return str(row[0]) if row else None


async def order_totals(session: AsyncSession, order_id: UUID) -> tuple[Decimal, Decimal] | None:
    """(grand_total, paid) from the derived view. paid nets refunds. None if no order."""
    result = await session.execute(
        text("SELECT grand_total, paid FROM order_outstanding WHERE order_id = :id"),
        {"id": str(order_id)},
    )
    row = result.first()
    if row is None:
        return None
    return Decimal(str(row[0])), Decimal(str(row[1] or 0))


async def salesperson_role(session: AsyncSession, salesperson_id: UUID) -> str | None:
    result = await session.execute(
        text("SELECT role FROM salespersons WHERE id = :id AND active = true"),
        {"id": str(salesperson_id)},
    )
    row = result.first()
    return row[0] if row else None


async def record_payment(
    session: AsyncSession, *, receipt_no: str, order_id: UUID, customer_id: str, kind: str,
    amount: Decimal, mode: str, paid_at: datetime, reference: str | None = None,
    recorded_by: UUID | None = None, notes: str | None = None,
) -> UUID:
    """Insert an immutable payment row. Commit is the caller's responsibility."""
    result = await session.execute(
        text(
            "INSERT INTO payments (receipt_no, order_id, customer_id, kind, amount, mode,"
            " reference, paid_at, recorded_by, notes)"
            " VALUES (:rcp, :oid, :cid, :kind, :amount, :mode, :ref,"
            " cast(:paid_at AS timestamptz), :rby, :notes) RETURNING id"
        ),
        {
            "rcp": receipt_no, "oid": str(order_id), "cid": customer_id, "kind": kind,
            "amount": amount, "mode": mode, "ref": reference, "paid_at": paid_at,
            "rby": str(recorded_by) if recorded_by else None, "notes": notes,
        },
    )
    return UUID(str(result.scalar_one()))


async def mark_earliest_schedule_paid(session: AsyncSession, order_id: UUID, amount: Decimal) -> None:
    """Heuristic: mark the earliest still-pending/due schedule 'paid' when this
    single payment covers its amount. Conservative — never marks more than one."""
    await session.execute(
        text(
            "UPDATE payment_schedules SET status = 'paid'"
            " WHERE id = ("
            "   SELECT id FROM payment_schedules"
            "   WHERE order_id = :oid AND status IN ('pending', 'due') AND amount <= :amt"
            "   ORDER BY due_date LIMIT 1"
            " )"
        ),
        {"oid": str(order_id), "amt": amount},
    )


async def replace_schedule(session: AsyncSession, order_id: UUID, rows: list[ScheduleRow]) -> None:
    """Replace all schedule rows for an order (only unpaid ones are removed;
    'paid' history is preserved)."""
    await session.execute(
        text("DELETE FROM payment_schedules WHERE order_id = :oid AND status IN ('pending', 'due')"),
        {"oid": str(order_id)},
    )
    for r in rows:
        await session.execute(
            text(
                "INSERT INTO payment_schedules (order_id, label, due_date, amount)"
                " VALUES (:oid, :label, :due, :amount)"
            ),
            {"oid": str(order_id), "label": r.label, "due": r.due_date, "amount": r.amount},
        )


@dataclass(frozen=True)
class DueSchedule:
    schedule_id: UUID
    order_id: UUID
    customer_id: UUID
    order_no: str
    amount: Decimal
    due_date: date


async def due_schedules(session: AsyncSession, within_days: int) -> list[DueSchedule]:
    """Pending schedules due within `within_days`. Flips them to 'due' and returns
    them for the reminder task (idempotent via the pending->due transition)."""
    result = await session.execute(
        text(
            "UPDATE payment_schedules ps SET status = 'due', updated_at = now()"
            " FROM orders o"
            " WHERE ps.order_id = o.id AND ps.status = 'pending'"
            "   AND ps.due_date <= (current_date + make_interval(days => :days))"
            " RETURNING ps.id, ps.order_id, o.customer_id, o.order_no, ps.amount, ps.due_date"
        ),
        {"days": within_days},
    )
    return [
        DueSchedule(
            schedule_id=UUID(str(r.id)), order_id=UUID(str(r.order_id)),
            customer_id=UUID(str(r.customer_id)), order_no=str(r.order_no),
            amount=Decimal(str(r.amount)), due_date=r.due_date,
        )
        for r in result.all()
    ]
