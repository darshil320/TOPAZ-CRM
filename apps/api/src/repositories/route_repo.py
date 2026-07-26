"""Route legs + route templates (module 14, migration 0030).

Raw SQL on an AsyncSession; caller owns the transaction.

LEGS ARE THE PLAN, ASSIGNMENTS ARE THE PRESENT. Nothing here writes
order_item_assignments or order_items — activating a leg goes through
production_repo.allocate(), so the one-active-assignment invariant and the
sync_order_item_workshop() denorm keep exactly one writer each.

Every validation decision (contiguity, span direction, deadlines) is made in
services/route_plan.py before any of these functions are called.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import audit_repo

_LEG_FIELDS = (
    "id", "order_item_id", "seq", "workshop_id", "stage_from", "stage_to",
    "planned_days", "due_at", "status", "activated_at", "completed_at",
    "created_by", "created_at", "updated_at",
)
_LEG_COLUMNS = ", ".join(_LEG_FIELDS)

# Statuses a leg can be in without the route being finished with it. A route may be
# REPLACED while every leg is still in one of these; once work has started at a leg,
# only the pending tail can be edited.
OPEN_LEG_STATUSES = ("pending", "in_transit", "active")


async def legs_for_item(session: AsyncSession, order_item_id: UUID) -> list[dict]:
    """The whole route in sequence, with workshop names for display."""
    result = await session.execute(
        text(
            f"SELECT {', '.join(f'l.{f}' for f in _LEG_FIELDS)}, w.name AS workshop_name,"
            "       w.type AS workshop_type, w.address AS workshop_address"
            " FROM order_item_route_legs l JOIN workshops w ON w.id = l.workshop_id"
            " WHERE l.order_item_id = :item ORDER BY l.seq"
        ),
        {"item": str(order_item_id)},
    )
    return [dict(m) for m in result.mappings().all()]


async def lock_legs_for_item(session: AsyncSession, order_item_id: UUID) -> list[dict]:
    """SELECT ... FOR UPDATE across the item's legs.

    Taken by the receive transaction and by re-planning: order_item_route_legs_one_active
    is the DB backstop, but locking first means the loser of a concurrent receive queues
    and gets a clean 409 from re-read state instead of a raw unique_violation.
    """
    result = await session.execute(
        text(
            f"SELECT {_LEG_COLUMNS} FROM order_item_route_legs"
            " WHERE order_item_id = :item ORDER BY seq FOR UPDATE"
        ),
        {"item": str(order_item_id)},
    )
    return [dict(m) for m in result.mappings().all()]


async def active_leg(session: AsyncSession, order_item_id: UUID) -> dict | None:
    result = await session.execute(
        text(
            f"SELECT {_LEG_COLUMNS} FROM order_item_route_legs"
            " WHERE order_item_id = :item AND status = 'active'"
        ),
        {"item": str(order_item_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def leg_by_seq(session: AsyncSession, order_item_id: UUID, seq: int) -> dict | None:
    result = await session.execute(
        text(
            f"SELECT {_LEG_COLUMNS} FROM order_item_route_legs"
            " WHERE order_item_id = :item AND seq = :seq"
        ),
        {"item": str(order_item_id), "seq": seq},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def get_leg(session: AsyncSession, leg_id: UUID) -> dict | None:
    result = await session.execute(
        text(f"SELECT {_LEG_COLUMNS} FROM order_item_route_legs WHERE id = :id"),
        {"id": str(leg_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def insert_leg(
    session: AsyncSession,
    *,
    order_item_id: UUID,
    seq: int,
    workshop_id: str | UUID,
    stage_from: str,
    stage_to: str,
    planned_days: int | None,
    due_at: datetime | None,
    status: str = "pending",
    actor_id: str | UUID | None = None,
) -> dict:
    result = await session.execute(
        text(
            "INSERT INTO order_item_route_legs"
            " (order_item_id, seq, workshop_id, stage_from, stage_to, planned_days,"
            "  due_at, status, created_by)"
            " VALUES (:item, :seq, :ws, :from, :to, :days, :due, :status, cast(:actor as uuid))"
            f" RETURNING {_LEG_COLUMNS}"
        ),
        {
            "item": str(order_item_id), "seq": seq, "ws": str(workshop_id),
            "from": stage_from, "to": stage_to, "days": planned_days, "due": due_at,
            "status": status, "actor": str(actor_id) if actor_id else None,
        },
    )
    return dict(result.mappings().one())


async def set_leg_status(
    session: AsyncSession,
    leg_id: UUID | str,
    status: str,
    *,
    stamp_activated: bool = False,
    stamp_completed: bool = False,
) -> dict | None:
    """Move a leg's status, stamping the matching timestamp.

    The timestamps are set here rather than defaulted in SQL because a leg can reach
    `completed` two legitimate ways (the span's last stage was ticked, or a lead handed
    over early) and both must land the same audit trail.
    """
    sets = ["status = :status"]
    if stamp_activated:
        sets.append("activated_at = coalesce(activated_at, now())")
    if stamp_completed:
        sets.append("completed_at = coalesce(completed_at, now())")
    result = await session.execute(
        text(
            f"UPDATE order_item_route_legs SET {', '.join(sets)}"
            f" WHERE id = :id RETURNING {_LEG_COLUMNS}"
        ),
        {"id": str(leg_id), "status": status},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def set_leg_due_at(session: AsyncSession, leg_id: UUID | str, due_at: datetime | None) -> None:
    await session.execute(
        text("UPDATE order_item_route_legs SET due_at = :due WHERE id = :id"),
        {"id": str(leg_id), "due": due_at},
    )


async def cancel_open_legs(
    session: AsyncSession, order_item_id: UUID, *, from_seq: int = 1
) -> int:
    """Cancel the open legs at or after `from_seq`. Used when a route is re-planned.

    Legs are cancelled, never deleted: a leg that was `active` is a record of goods
    having physically been somewhere, and the transfer rows FK it.
    """
    result = await session.execute(
        text(
            "UPDATE order_item_route_legs SET status = 'cancelled'"
            " WHERE order_item_id = :item AND seq >= :seq"
            "   AND status IN ('pending', 'in_transit', 'active')"
        ),
        {"item": str(order_item_id), "seq": from_seq},
    )
    return int(result.rowcount or 0)


async def max_seq(session: AsyncSession, order_item_id: UUID) -> int:
    result = await session.execute(
        text("SELECT coalesce(max(seq), 0) FROM order_item_route_legs WHERE order_item_id = :item"),
        {"item": str(order_item_id)},
    )
    return int(result.scalar_one())


async def record_route_audit(
    session: AsyncSession,
    *,
    order_item_id: UUID,
    action: str,
    actor_id: str | UUID | None,
    payload: dict,
) -> None:
    await audit_repo.record(
        session, entity="order_item_route_legs", entity_id=order_item_id,
        action=action, actor=actor_id, payload=payload,
    )


async def overdue_active_legs(session: AsyncSession, *, limit: int = 200) -> list[dict]:
    """Active legs whose deadline has passed and whose span is not finished — module
    12's watchdog input. Served by order_item_route_legs_due_idx.

    Blocked items are INCLUDED: a blocked item is exactly the one whose deadline the
    owner needs to hear about. Items with no due_at are excluded — the watchdog must
    not count days against nobody (0024's rule).
    """
    result = await session.execute(
        text(
            "SELECT l.id AS leg_id, l.order_item_id, l.seq, l.workshop_id, l.due_at,"
            "       l.stage_from, l.stage_to,"
            "       oi.description, oi.current_stage, oi.blocked, oi.order_id,"
            "       o.order_no, o.customer_id, c.name AS customer_name,"
            "       w.name AS workshop_name"
            " FROM order_item_route_legs l"
            " JOIN order_items oi ON oi.id = l.order_item_id"
            " JOIN orders o ON o.id = oi.order_id"
            " JOIN customers c ON c.id = o.customer_id"
            " JOIN workshops w ON w.id = l.workshop_id"
            " WHERE l.status = 'active' AND l.due_at IS NOT NULL AND l.due_at < now()"
            "   AND oi.production_done_at IS NULL"
            " ORDER BY l.due_at LIMIT :limit"
        ),
        {"limit": limit},
    )
    return [dict(m) for m in result.mappings().all()]


# ─── Route templates ─────────────────────────────────────────────────────────
async def list_templates(session: AsyncSession, *, active_only: bool = True) -> list[dict]:
    """Templates with their legs nested, so the builder's dropdown is one round trip."""
    result = await session.execute(
        text(
            "SELECT t.id, t.name, t.notes, t.active, t.created_at,"
            "       l.id AS leg_id, l.seq, l.workshop_id, l.stage_from, l.stage_to,"
            "       l.planned_days, w.name AS workshop_name"
            " FROM production_route_templates t"
            " LEFT JOIN production_route_template_legs l ON l.template_id = t.id"
            " LEFT JOIN workshops w ON w.id = l.workshop_id"
            " WHERE (:active_only = false OR t.active = true)"
            " ORDER BY lower(t.name), l.seq"
        ),
        {"active_only": active_only},
    )
    templates: dict[str, dict] = {}
    for row in result.mappings().all():
        tid = str(row["id"])
        if tid not in templates:
            templates[tid] = {
                "id": tid, "name": row["name"], "notes": row["notes"],
                "active": row["active"], "created_at": row["created_at"], "legs": [],
            }
        if row["leg_id"] is not None:
            templates[tid]["legs"].append({
                "id": str(row["leg_id"]), "seq": row["seq"],
                "workshop_id": str(row["workshop_id"]),
                "workshop_name": row["workshop_name"],
                "stage_from": row["stage_from"], "stage_to": row["stage_to"],
                "planned_days": row["planned_days"],
            })
    return list(templates.values())


async def get_template_legs(session: AsyncSession, template_id: UUID) -> list[dict]:
    result = await session.execute(
        text(
            "SELECT seq, workshop_id, stage_from, stage_to, planned_days"
            " FROM production_route_template_legs WHERE template_id = :id ORDER BY seq"
        ),
        {"id": str(template_id)},
    )
    return [dict(m) for m in result.mappings().all()]


async def create_template(
    session: AsyncSession, *, name: str, notes: str | None, actor_id: str | UUID | None
) -> dict:
    result = await session.execute(
        text(
            "INSERT INTO production_route_templates (name, notes, created_by)"
            " VALUES (:name, :notes, cast(:actor as uuid))"
            " RETURNING id, name, notes, active, created_at"
        ),
        {"name": name, "notes": notes, "actor": str(actor_id) if actor_id else None},
    )
    return dict(result.mappings().one())


async def replace_template_legs(
    session: AsyncSession, template_id: UUID, legs: list[dict]
) -> None:
    """Wholesale replace. A template is a draft, not a record of anything that
    happened, so DELETE is the honest operation here (0030 grants it for this table
    and no other)."""
    await session.execute(
        text("DELETE FROM production_route_template_legs WHERE template_id = :id"),
        {"id": str(template_id)},
    )
    for i, leg in enumerate(legs, start=1):
        await session.execute(
            text(
                "INSERT INTO production_route_template_legs"
                " (template_id, seq, workshop_id, stage_from, stage_to, planned_days)"
                " VALUES (:id, :seq, :ws, :from, :to, :days)"
            ),
            {
                "id": str(template_id), "seq": i, "ws": str(leg["workshop_id"]),
                "from": leg["stage_from"], "to": leg["stage_to"],
                "days": leg["planned_days"],
            },
        )


async def deactivate_template(session: AsyncSession, template_id: UUID) -> dict | None:
    result = await session.execute(
        text(
            "UPDATE production_route_templates SET active = false WHERE id = :id"
            " RETURNING id, name, notes, active, created_at"
        ),
        {"id": str(template_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)
