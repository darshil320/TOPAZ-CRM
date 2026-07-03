"""Customer repository — lookup by id or wa_id, handler state updates."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class CustomerInfo:
    id: UUID
    name: str | None
    wa_id: str | None
    ai_followup_enabled: bool
    handler_mode: str


async def get_customer_by_id(
    session: AsyncSession,
    customer_id: UUID,
) -> CustomerInfo | None:
    result = await session.execute(
        text(
            "SELECT id, name, wa_id, ai_followup_enabled, handler_mode"
            " FROM customers WHERE id = :cid"
        ),
        {"cid": str(customer_id)},
    )
    row = result.first()
    if not row:
        return None
    return CustomerInfo(
        id=UUID(str(row.id)),
        name=str(row.name) if row.name else None,
        wa_id=str(row.wa_id) if row.wa_id else None,
        ai_followup_enabled=bool(row.ai_followup_enabled),
        handler_mode=str(row.handler_mode),
    )


async def get_customer_by_wa_id(
    session: AsyncSession,
    wa_id: str,
) -> CustomerInfo | None:
    result = await session.execute(
        text(
            "SELECT id, name, wa_id, ai_followup_enabled, handler_mode"
            " FROM customers WHERE wa_id = :wid"
        ),
        {"wid": wa_id},
    )
    row = result.first()
    if not row:
        return None
    return CustomerInfo(
        id=UUID(str(row.id)),
        name=str(row.name) if row.name else None,
        wa_id=str(row.wa_id) if row.wa_id else None,
        ai_followup_enabled=bool(row.ai_followup_enabled),
        handler_mode=str(row.handler_mode),
    )


async def touch_last_inbound_at(
    session: AsyncSession,
    customer_id: UUID,
    at: datetime,
) -> None:
    """Update last_inbound_at to track the 24-h free-form window."""
    await session.execute(
        text("UPDATE customers SET last_inbound_at = cast(:at AS timestamptz) WHERE id = :cid"),
        {"at": at, "cid": str(customer_id)},
    )
