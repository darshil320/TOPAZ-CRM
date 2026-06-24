"""Face-embedding repository — ANN query only (§19-D: no consent join).

The DPDPA consent gate is enforced at write time by the DB trigger
`face_embedding_consent_gate` (0004_functions_and_triggers.sql).
Every row in face_embeddings therefore already has active face_tracking consent,
so we query without a consent join to preserve HNSW index selectivity.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings


@dataclass(frozen=True)
class NearestEmbedding:
    customer_id: UUID
    similarity: float


async def find_nearest(
    session: AsyncSession,
    embedding: list[float],
    n: int = 5,
) -> list[NearestEmbedding]:
    """Return the n nearest stored embeddings by cosine similarity.

    Uses SET LOCAL (session-scoped) hnsw.ef_search to tune recall without
    affecting other concurrent queries. The vector is cast via SQL (:vec)::vector
    to avoid dependency on the pgvector SQLAlchemy codec registration.

    §19-D: no join to consents; the write-time trigger guarantees consent.
    """
    settings = get_settings()
    ef = str(settings.HNSW_EF_SEARCH)
    vec_literal = "[" + ",".join(str(f) for f in embedding) + "]"

    await session.execute(
        text("SELECT set_config('hnsw.ef_search', :ef, true)"),
        {"ef": ef},
    )

    result = await session.execute(
        text(
            "SELECT customer_id, 1 - (embedding <=> (:vec)::vector) AS similarity"
            " FROM face_embeddings"
            " ORDER BY embedding <=> (:vec)::vector"
            " LIMIT :n"
        ),
        {"vec": vec_literal, "n": n},
    )

    return [
        NearestEmbedding(customer_id=UUID(str(row.customer_id)), similarity=float(row.similarity))
        for row in result
    ]
