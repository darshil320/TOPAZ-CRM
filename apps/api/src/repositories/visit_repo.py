"""Visit repository — idempotent write + lookup by raw_event_id."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_visit_id_by_raw_event_id(
    session: AsyncSession,
    raw_event_id: UUID,
) -> UUID | None:
    """Return the visit.id for a previously processed edge event, or None."""
    result = await session.execute(
        text("SELECT id FROM visits WHERE raw_event_id = :rid"),
        {"rid": str(raw_event_id)},
    )
    row = result.first()
    return UUID(str(row.id)) if row else None


async def create_visit(
    session: AsyncSession,
    *,
    raw_event_id: UUID,
    match_band: str,
    match_score: float | None,
    customer_id: UUID | None,
    photo_key: str | None,
    salesperson_id: UUID | None = None,
) -> UUID:
    """Insert a visit row idempotently and return the visit.id.

    Uses DO UPDATE with a no-op set to always return the winning row's ID,
    whether this call won the insert race or a concurrent worker did (H-2 fix).
    Commit is the caller's responsibility (M-3 fix: removed commit from repo).
    salesperson_id is set for REPEAT visits where the primary assignment is known;
    this populates the Supabase Realtime filter used by the dashboard alert banner.
    """
    result = await session.execute(
        text(
            "INSERT INTO visits"
            " (raw_event_id, match_band, match_score, customer_id, photo_key, salesperson_id)"
            " VALUES (:rid, :band, :score, :cid, :pkey, :spid)"
            " ON CONFLICT (raw_event_id)"
            " DO UPDATE SET raw_event_id = EXCLUDED.raw_event_id"
            " RETURNING id"
        ),
        {
            "rid": str(raw_event_id),
            "band": match_band,
            "score": match_score,
            "cid": str(customer_id) if customer_id else None,
            "pkey": photo_key,
            "spid": str(salesperson_id) if salesperson_id else None,
        },
    )
    row = result.first()
    return UUID(str(row.id))
