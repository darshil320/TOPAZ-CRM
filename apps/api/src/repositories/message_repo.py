"""Message repository — create inbound/outbound message rows."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create_message(
    session: AsyncSession,
    *,
    customer_id: UUID,
    direction: str,
    content: str,
    sender_type: str,
    draft_status: str | None = None,
    status: str = "pending",
    wamid: str | None = None,
    ai_generated: bool = False,
    sender_salesperson_id: UUID | None = None,
) -> UUID:
    """Insert a message row and return its id.

    Commit is the caller's responsibility.
    """
    result = await session.execute(
        text(
            "INSERT INTO messages"
            " (customer_id, direction, content, sender_type, draft_status,"
            "  status, wamid, ai_generated, sender_salesperson_id)"
            " VALUES (:cid, :dir, :content, :st, :ds, :status, :wamid, :ai, :ssid)"
            " RETURNING id"
        ),
        {
            "cid": str(customer_id),
            "dir": direction,
            "content": content,
            "st": sender_type,
            "ds": draft_status,
            "status": status,
            "wamid": wamid,
            "ai": ai_generated,
            "ssid": str(sender_salesperson_id) if sender_salesperson_id else None,
        },
    )
    row = result.first()
    return UUID(str(row.id))
