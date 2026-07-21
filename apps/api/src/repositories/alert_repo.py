"""Alert repository — create intent-trigger / alert-history rows (M5/M6B)."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create_alert(
    session: AsyncSession,
    *,
    customer_id: UUID,
    type_: str,
    salesperson_id: UUID | None = None,
    detail: str | None = None,
    message_id: UUID | None = None,
) -> UUID:
    """Insert an alert row and return its id.

    Commit is the caller's responsibility. Written by the backend (service role),
    so RLS insert policies do not apply — reads are RLS-scoped in 0010.
    """
    result = await session.execute(
        text(
            "INSERT INTO alerts (customer_id, salesperson_id, type, detail, message_id)"
            " VALUES (:cid, :sid, :type, :detail, :mid)"
            " RETURNING id"
        ),
        {
            "cid": str(customer_id),
            "sid": str(salesperson_id) if salesperson_id else None,
            "type": type_,
            "detail": detail,
            "mid": str(message_id) if message_id else None,
        },
    )
    row = result.first()
    return UUID(str(row.id))


async def get_owner_whatsapp(session: AsyncSession) -> str | None:
    """WhatsApp number of an active owner — fallback recipient for unclaimed customers."""
    result = await session.execute(
        text(
            "SELECT whatsapp FROM salespersons"
            " WHERE role = 'owner' AND active = true AND whatsapp IS NOT NULL"
            " ORDER BY created_at LIMIT 1"
        )
    )
    row = result.first()
    return str(row.whatsapp) if row and row.whatsapp else None
