"""Assignment repository — primary salesperson lookup for a customer."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_primary_salesperson(
    session: AsyncSession,
    customer_id: UUID,
) -> tuple[UUID, str] | None:
    """Return (salesperson_id, whatsapp_e164) for the active primary assignment, or None.

    Joins salespersons to ensure the salesperson is active (not terminated/left).
    """
    result = await session.execute(
        text(
            "SELECT sp.id, sp.whatsapp"
            " FROM customer_assignments ca"
            " JOIN salespersons sp ON sp.id = ca.salesperson_id"
            " WHERE ca.customer_id = :cid"
            "   AND ca.role = 'primary'"
            "   AND ca.active = true"
            "   AND sp.active = true"
            " LIMIT 1"
        ),
        {"cid": str(customer_id)},
    )
    row = result.first()
    if not row:
        return None
    return UUID(str(row.id)), str(row.whatsapp)
