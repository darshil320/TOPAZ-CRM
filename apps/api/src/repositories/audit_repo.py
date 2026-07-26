"""audit_log writes — one entry point so every audited action looks the same.

`audit_log` is append-only (0002); `actor` is TEXT (a salesperson id stringified,
or 'system' for trigger-written rows). The payload is serialised in Python and cast
once in SQL, because asyncpg cannot infer a type for a bare NULL passed to
jsonb_build_object — building the JSON here sidesteps that class of bug entirely.
"""

import json
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def record(
    session: AsyncSession,
    *,
    entity: str,
    entity_id: UUID | str | None,
    action: str,
    actor: UUID | str | None = None,
    payload: dict | None = None,
) -> None:
    """Append an audit row. Commit is the caller's responsibility."""
    await session.execute(
        text(
            "INSERT INTO audit_log (entity, entity_id, action, actor, payload)"
            " VALUES (:entity, cast(:entity_id as uuid), :action, cast(:actor as text),"
            "         cast(:payload as jsonb))"
        ),
        {
            "entity": entity,
            "entity_id": str(entity_id) if entity_id else None,
            "action": action,
            "actor": str(actor) if actor else None,
            "payload": json.dumps(payload, default=str) if payload is not None else None,
        },
    )
