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
) -> UUID | None:
    """Insert a visit row; silently skips duplicates (ON CONFLICT DO NOTHING).

    Returns the visit.id if inserted, None if the raw_event_id already exists.
    """
    result = await session.execute(
        text(
            "INSERT INTO visits (raw_event_id, match_band, match_score, customer_id, photo_key)"
            " VALUES (:rid, :band, :score, :cid, :pkey)"
            " ON CONFLICT (raw_event_id) DO NOTHING"
            " RETURNING id"
        ),
        {
            "rid": str(raw_event_id),
            "band": match_band,
            "score": match_score,
            "cid": str(customer_id) if customer_id else None,
            "pkey": photo_key,
        },
    )
    row = result.first()
    await session.commit()
    return UUID(str(row.id)) if row else None
