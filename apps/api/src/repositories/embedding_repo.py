"""Face-embedding repository — ANN query only (§19-D: no consent join).

The DPDPA consent gate is enforced at write time by the DB trigger
`face_embedding_consent_gate` (0004_functions_and_triggers.sql).
Every row in face_embeddings therefore already has active face_tracking consent,
so we query without a consent join to preserve HNSW index selectivity.
"""

import math
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

    SET LOCAL inside an explicit transaction ensures ef_search is active for the
    ANN query in the same transaction scope (C-2 fix). A CTE materialises the
    vector cast once so the HNSW planner sees one expression (H-1 fix).
    The vector literal is built from validated finite floats (M-2 fix).

    §19-D: no join to consents; the write-time trigger guarantees consent.
    """
    if not all(math.isfinite(f) for f in embedding):
        raise ValueError("embedding contains non-finite values (nan/inf)")

    settings = get_settings()
    ef = str(settings.HNSW_EF_SEARCH)
    vec_literal = "[" + ",".join(str(f) for f in embedding) + "]"

    async with session.begin():
        await session.execute(
            text("SET LOCAL hnsw.ef_search = :ef"),
            {"ef": ef},
        )
        result = await session.execute(
            text(
                "WITH q AS (SELECT (:vec)::vector AS qvec)"
                " SELECT customer_id, 1 - (embedding <=> q.qvec) AS similarity"
                " FROM face_embeddings, q"
                " ORDER BY embedding <=> q.qvec"
                " LIMIT :n"
            ),
            {"vec": vec_literal, "n": n},
        )
        rows = result.all()

    return [
        NearestEmbedding(customer_id=UUID(str(row.customer_id)), similarity=float(row.similarity))
        for row in rows
    ]
