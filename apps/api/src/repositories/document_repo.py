"""Documents registry — one row per generated PDF. Service-role writes only
(the migration grants authenticated SELECT but no INSERT; the Celery task runs
on the direct DB connection, not an RLS-limited role)."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def next_version(session: AsyncSession, entity_type: str, entity_id: UUID) -> int:
    """Next version number for an entity's documents (1-based)."""
    result = await session.execute(
        text(
            "SELECT coalesce(max(version), 0) + 1 FROM documents"
            " WHERE entity_type = :et AND entity_id = :eid"
        ),
        {"et": entity_type, "eid": str(entity_id)},
    )
    return int(result.scalar_one())


async def latest_storage_key(
    session: AsyncSession, entity_type: str, entity_id: UUID, kind: str
) -> str | None:
    """Storage key of the most recent document of a kind for an entity, or None."""
    result = await session.execute(
        text(
            "SELECT storage_key FROM documents"
            " WHERE entity_type = :et AND entity_id = :eid AND kind = :kind"
            " ORDER BY version DESC LIMIT 1"
        ),
        {"et": entity_type, "eid": str(entity_id), "kind": kind},
    )
    row = result.first()
    return None if row is None else str(row[0])


async def insert_document(
    session: AsyncSession,
    *,
    kind: str,
    entity_type: str,
    entity_id: UUID,
    storage_key: str,
    version: int,
) -> UUID:
    """Record a generated document. Commit is the caller's responsibility."""
    result = await session.execute(
        text(
            "INSERT INTO documents (kind, entity_type, entity_id, storage_key, version)"
            " VALUES (:kind, :et, :eid, :key, :ver) RETURNING id"
        ),
        {"kind": kind, "et": entity_type, "eid": str(entity_id), "key": storage_key, "ver": version},
    )
    return UUID(str(result.scalar_one()))
