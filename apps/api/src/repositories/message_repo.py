"""Message repository — create inbound/outbound message rows."""

from datetime import datetime
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
    category: str | None = None,
    template_name: str | None = None,
    sent_at: datetime | None = None,
) -> UUID:
    """Insert a message row and return its id.

    Commit is the caller's responsibility.
    """
    result = await session.execute(
        text(
            "INSERT INTO messages"
            " (customer_id, direction, content, sender_type, draft_status,"
            "  status, wamid, ai_generated, sender_salesperson_id,"
            "  category, template_name, sent_at)"
            " VALUES (:cid, :dir, :content, :st, :ds, :status, :wamid, :ai, :ssid,"
            "         :category, :template_name, cast(:sent_at AS timestamptz))"
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
            "category": category,
            "template_name": template_name,
            "sent_at": sent_at,
        },
    )
    row = result.first()
    return UUID(str(row.id))


async def mark_message_sent(
    session: AsyncSession,
    message_id: UUID,
    wamid: str,
) -> None:
    """Record a successful WhatsApp send on an existing message row."""
    await session.execute(
        text(
            "UPDATE messages"
            " SET status = 'sent', wamid = :wamid, sent_at = now(), updated_at = now()"
            " WHERE id = :mid"
        ),
        {"wamid": wamid, "mid": str(message_id)},
    )


async def mark_message_failed(
    session: AsyncSession,
    message_id: UUID,
) -> None:
    await session.execute(
        text(
            "UPDATE messages SET status = 'failed', updated_at = now() WHERE id = :mid"
        ),
        {"mid": str(message_id)},
    )


async def update_status_by_wamid(
    session: AsyncSession,
    wamid: str,
    status: str,
) -> bool:
    """Apply a Meta delivery-status event; returns False if no matching row.

    Never regresses a richer status (read stays read even if a late
    'delivered' event arrives out of order). 'failed' is terminal and always
    applies — Meta can fail a message after reporting it sent.
    """
    rank = "CASE status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'sent' THEN 2 ELSE 1 END"
    new_rank = "CASE :status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'sent' THEN 2 ELSE 1 END"
    result = await session.execute(
        text(
            "UPDATE messages SET status = :status, updated_at = now()"
            " WHERE wamid = :wamid AND status != 'failed'"
            f"   AND (:status = 'failed' OR ({new_rank}) > ({rank}))"
        ),
        {"status": status, "wamid": wamid},
    )
    return result.rowcount > 0
