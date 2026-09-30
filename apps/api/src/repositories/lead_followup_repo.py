"""Lead follow-up due-date scan + in-app notification persistence.

Two distinct concerns share this module because they're two sides of the same
feature, but kept separate from lead_repo.py (leads.followup_due_on/
followup_notified_at) and this table (lead_followup_notifications) are
different tables with different lifecycles — mirrors the stage_plan_repo.py
vs order_item_repo.py split already in this codebase.

due_followups/claim_followup operate on `leads` (the claim state lives there,
see 0050's header). Everything else operates on lead_followup_notifications,
which the daily beat task creates, RLS gates to "my own or owner", and which
is never hard-deleted — only cleared_at is ever set, mirroring leads' own
"no delete policy, mark don't remove" precedent.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_NOTIFICATION_FIELDS = (
    "id", "lead_id", "salesperson_id", "due_on", "created_at", "cleared_at",
)
_NOTIFICATION_COLUMNS = ", ".join(_NOTIFICATION_FIELDS)


async def due_followups(session: AsyncSession, *, limit: int = 200) -> list[dict]:
    """Leads whose follow-up is due, not yet notified, and not terminal.

    Index-served by leads_followup_due_idx (0050). Returns enough to resolve a
    recipient and create the notification without a second query per row.
    """
    result = await session.execute(
        text(
            "SELECT id, name, phone, followup_due_on, assigned_to, created_by"
            " FROM leads"
            " WHERE followup_due_on IS NOT NULL"
            "   AND followup_due_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date"
            "   AND followup_notified_at IS NULL"
            "   AND status NOT IN ('converted', 'lost')"
            " ORDER BY followup_due_on"
            " LIMIT :limit"
        ),
        {"limit": limit},
    )
    return [dict(r) for r in result.mappings().all()]


async def claim_followup(session: AsyncSession, lead_id: UUID) -> bool:
    """Atomic one-time claim. Returns whether THIS call claimed the row.

    A simple null-check UPDATE, not the daily-repeat claim stage_plan_repo.
    claim_reminder uses — a follow-up notification fires once, ever, per due
    date; staying visible until manually cleared is what gives it permanence,
    so there is no "already claimed today" re-check to make, only "already
    claimed at all".
    """
    result = await session.execute(
        text(
            "UPDATE leads SET followup_notified_at = now()"
            " WHERE id = :id AND followup_notified_at IS NULL"
            " RETURNING id"
        ),
        {"id": str(lead_id)},
    )
    return result.first() is not None


async def create_notification(
    session: AsyncSession, *, lead_id: UUID, salesperson_id: UUID, due_on
) -> dict | None:
    """INSERT, defensively no-op on the (lead_id, salesperson_id, due_on) uindex —
    claim_followup is the primary dedupe; this is belt-and-suspenders for a race
    that somehow re-armed followup_notified_at between claim and here."""
    result = await session.execute(
        text(
            "INSERT INTO lead_followup_notifications (lead_id, salesperson_id, due_on)"
            " VALUES (:lead_id, :salesperson_id, :due_on)"
            " ON CONFLICT (lead_id, salesperson_id, due_on) DO NOTHING"
            f" RETURNING {_NOTIFICATION_COLUMNS}"
        ),
        {"lead_id": str(lead_id), "salesperson_id": str(salesperson_id), "due_on": due_on},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def list_notifications(
    session: AsyncSession, *, salesperson_id: str | None
) -> list[dict]:
    """salesperson_id=None means owner — every unread+cleared row, newest first,
    capped. Joined to leads for name/phone/status so the bell panel needs no
    second fetch per notification."""
    where = "" if salesperson_id is None else " WHERE n.salesperson_id = :sid"
    result = await session.execute(
        text(
            "SELECT n.id, n.lead_id, n.due_on, n.created_at, n.cleared_at,"
            "       l.name AS lead_name, l.phone AS lead_phone, l.status AS lead_status"
            " FROM lead_followup_notifications n"
            " JOIN leads l ON l.id = n.lead_id"
            f"{where}"
            " ORDER BY n.cleared_at IS NULL DESC, n.created_at DESC"
            " LIMIT 200"
        ),
        {} if salesperson_id is None else {"sid": salesperson_id},
    )
    return [dict(r) for r in result.mappings().all()]


async def unread_count(session: AsyncSession, *, salesperson_id: str | None) -> int:
    where = "cleared_at IS NULL"
    params: dict = {}
    if salesperson_id is not None:
        where += " AND salesperson_id = :sid"
        params["sid"] = salesperson_id
    result = await session.execute(
        text(f"SELECT count(*) FROM lead_followup_notifications WHERE {where}"), params
    )
    return int(result.scalar_one())


async def get_notification(session: AsyncSession, notification_id: UUID) -> dict | None:
    result = await session.execute(
        text(f"SELECT {_NOTIFICATION_COLUMNS} FROM lead_followup_notifications WHERE id = :id"),
        {"id": str(notification_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def clear_notification(session: AsyncSession, notification_id: UUID) -> dict | None:
    result = await session.execute(
        text(
            "UPDATE lead_followup_notifications SET cleared_at = now()"
            " WHERE id = :id AND cleared_at IS NULL"
            f" RETURNING {_NOTIFICATION_COLUMNS}"
        ),
        {"id": str(notification_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def clear_all(session: AsyncSession, *, salesperson_id: str | None) -> int:
    """salesperson_id=None means owner clearing every unread notification."""
    where = "cleared_at IS NULL"
    params: dict = {}
    if salesperson_id is not None:
        where += " AND salesperson_id = :sid"
        params["sid"] = salesperson_id
    result = await session.execute(
        text(f"UPDATE lead_followup_notifications SET cleared_at = now() WHERE {where} RETURNING id"),
        params,
    )
    return len(result.fetchall())
