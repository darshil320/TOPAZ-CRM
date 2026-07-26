"""Workshops repository — CRUD + the allocate page's load hints.

Raw SQL on an AsyncSession; caller owns the transaction. Workshops are never
deleted, only deactivated (assignments FK them) — there is no delete function here
on purpose.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Columns every workshop response returns. Kept in one place so the API, the list
# endpoint and the tests cannot drift.
_FIELDS = (
    "id", "name", "type", "manager_name", "manager_phone", "manager_salesperson_id",
    "address", "active", "created_at", "updated_at",
)
_COLUMNS = ", ".join(_FIELDS)
_COLUMNS_W = ", ".join(f"w.{f}" for f in _FIELDS)


async def get_workshop(session: AsyncSession, workshop_id: UUID) -> dict | None:
    result = await session.execute(
        text(f"SELECT {_COLUMNS} FROM workshops WHERE id = :id"), {"id": str(workshop_id)}
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def list_workshops(session: AsyncSession, *, active_only: bool = True) -> list[dict]:
    """Workshops with an `open_item_count` hint: active assignments whose item is
    still in production. Drives the allocate modal's per-workshop load display."""
    result = await session.execute(
        text(
            f"SELECT {_COLUMNS_W},"
            " coalesce(c.open_item_count, 0) AS open_item_count"
            " FROM workshops w"
            " LEFT JOIN ("
            "   SELECT a.workshop_id, count(*) AS open_item_count"
            "     FROM order_item_assignments a"
            "     JOIN order_items oi ON oi.id = a.order_item_id"
            "    WHERE a.active = true AND oi.production_done_at IS NULL"
            "    GROUP BY a.workshop_id"
            " ) c ON c.workshop_id = w.id"
            " WHERE (:active_only = false OR w.active = true)"
            " ORDER BY w.active DESC, lower(w.name)"
        ),
        {"active_only": active_only},
    )
    return [dict(m) for m in result.mappings().all()]


async def create_workshop(
    session: AsyncSession,
    *,
    name: str,
    type_: str,
    manager_name: str | None = None,
    manager_phone: str | None = None,
    manager_salesperson_id: UUID | None = None,
    address: str | None = None,
) -> dict:
    result = await session.execute(
        text(
            "INSERT INTO workshops (name, type, manager_name, manager_phone,"
            " manager_salesperson_id, address)"
            " VALUES (:name, :type, :manager_name, :manager_phone, :manager_sp, :address)"
            f" RETURNING {_COLUMNS}"
        ),
        {
            "name": name, "type": type_, "manager_name": manager_name,
            "manager_phone": manager_phone,
            "manager_sp": str(manager_salesperson_id) if manager_salesperson_id else None,
            "address": address,
        },
    )
    return dict(result.mappings().one())


async def update_workshop(session: AsyncSession, workshop_id: UUID, changes: dict) -> dict | None:
    """Patch the supplied columns only. `changes` keys are validated against a
    whitelist by the caller's Pydantic model; this re-checks so no caller can
    smuggle a column name into the SQL."""
    allowed = {"name", "type", "manager_name", "manager_phone", "manager_salesperson_id", "address"}
    fields = {k: v for k, v in changes.items() if k in allowed}
    if not fields:
        return await get_workshop(session, workshop_id)
    assignments = ", ".join(f"{k} = :{k}" for k in fields)
    params: dict = {**fields, "id": str(workshop_id)}
    if params.get("manager_salesperson_id") is not None:
        params["manager_salesperson_id"] = str(params["manager_salesperson_id"])
    result = await session.execute(
        text(f"UPDATE workshops SET {assignments} WHERE id = :id RETURNING {_COLUMNS}"), params
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def deactivate_workshop(session: AsyncSession, workshop_id: UUID) -> dict | None:
    result = await session.execute(
        text(f"UPDATE workshops SET active = false WHERE id = :id RETURNING {_COLUMNS}"),
        {"id": str(workshop_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def open_item_count(session: AsyncSession, workshop_id: UUID) -> int:
    """Active assignments at this workshop whose item is not finished. Guards
    deactivation: a workshop still holding live work must not disappear from the
    board."""
    result = await session.execute(
        text(
            "SELECT count(*) FROM order_item_assignments a"
            " JOIN order_items oi ON oi.id = a.order_item_id"
            " WHERE a.workshop_id = :id AND a.active = true"
            "   AND oi.production_done_at IS NULL"
        ),
        {"id": str(workshop_id)},
    )
    return int(result.scalar_one())


async def salesperson_exists(session: AsyncSession, salesperson_id: UUID) -> bool:
    result = await session.execute(
        text("SELECT 1 FROM salespersons WHERE id = :id AND active = true"),
        {"id": str(salesperson_id)},
    )
    return result.first() is not None
