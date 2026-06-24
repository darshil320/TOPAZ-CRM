"""Celery task: process_recognition_event.

Pipeline (§6.2):
  1. Idempotency — skip if visits.raw_event_id already exists.
  2. Quality gate — reject if quality_score < 0.4.
  3. ANN query — find nearest face embeddings via pgvector HNSW.
  4. Band classification — REPEAT / UNCERTAIN / NEW.
  5. Write visit row.
  6. REPEAT: load customer + trigger salesperson alert (TODO seam).
  7. NEW / UNCERTAIN: consent-gated enrollment seam (§19-E — no embedding
     without an active face_tracking consent token from a kiosk session).

All DB I/O uses a NullPool session (asyncio event-loop safety in Celery, §19-I).
"""

import asyncio
import logging
from datetime import datetime
from uuid import UUID

from .celery_app import celery_app
from ..config import get_settings
from ..database import make_task_session
from ..repositories.embedding_repo import find_nearest
from ..repositories.visit_repo import create_visit, get_visit_id_by_raw_event_id
from ..services.matching import classify_band

logger = logging.getLogger(__name__)

QUALITY_FLOOR = 0.4


@celery_app.task(
    bind=True,
    name="src.tasks.recognition.process_recognition_event",
    max_retries=3,
    default_retry_delay=5,
    acks_late=True,
)
def process_recognition_event(
    self,
    *,
    raw_event_id: str,
    embedding: list[float],
    quality_score: float,
    photo_key: str | None,
    camera_id: str,
    captured_at: str,
) -> dict:
    """Synchronous Celery entry point — delegates to the async pipeline."""
    try:
        return asyncio.run(
            _process(
                raw_event_id=UUID(raw_event_id),
                embedding=embedding,
                quality_score=quality_score,
                photo_key=photo_key,
                camera_id=camera_id,
                captured_at=datetime.fromisoformat(captured_at),
            )
        )
    except Exception as exc:
        logger.exception("Recognition task failed for %s", raw_event_id)
        raise self.retry(exc=exc)


async def _process(
    *,
    raw_event_id: UUID,
    embedding: list[float],
    quality_score: float,
    photo_key: str | None,
    camera_id: str,
    captured_at: datetime,
) -> dict:
    async with make_task_session() as session:
        # 1. Idempotency
        existing = await get_visit_id_by_raw_event_id(session, raw_event_id)
        if existing:
            logger.info("raw_event_id %s already processed (visit %s)", raw_event_id, existing)
            return {"status": "duplicate", "visit_id": str(existing)}

        # 2. Quality gate
        if quality_score < QUALITY_FLOOR:
            logger.info(
                "raw_event_id %s rejected: quality_score %.3f < %.1f",
                raw_event_id,
                quality_score,
                QUALITY_FLOOR,
            )
            return {"status": "rejected", "reason": "quality_too_low"}

        # 3. ANN query
        settings = get_settings()
        candidates = await find_nearest(session, embedding)

        # 4. Band classification
        top = candidates[0] if candidates else None
        top_similarity = top.similarity if top else 0.0
        band = classify_band(
            similarity=top_similarity,
            match_threshold=settings.MATCH_THRESHOLD,
            new_threshold=settings.NEW_THRESHOLD,
        )

        customer_id: UUID | None = top.customer_id if band == "REPEAT" else None

        # 5. Write visit + commit (create_visit does not commit — caller owns the UoW).
        visit_id = await create_visit(
            session,
            raw_event_id=raw_event_id,
            match_band=band,
            match_score=top_similarity if top else None,
            customer_id=customer_id,
            photo_key=photo_key,
        )
        await session.commit()

        # 6. REPEAT — alert seam (WhatsApp task → salesperson alert)
        if band == "REPEAT" and customer_id:
            # TODO(Layer 2): enqueue tasks.whatsapp.send_salesperson_alert(customer_id, visit_id)
            logger.info("REPEAT visit: customer=%s visit=%s", customer_id, visit_id)

        # 7. NEW / UNCERTAIN — consent-gated enrollment seam (§19-E)
        # Edge worker must attach a kiosk consent_token to the event before
        # we can persist an embedding or a customer row. No enrollment here.
        if band in ("NEW", "UNCERTAIN"):
            # TODO(Layer 2): if event carries consent_token → create_customer + enroll_embedding
            logger.info("band=%s visit=%s — awaiting consent for enrollment", band, visit_id)

        return {
            "status": "processed",
            "band": band,
            "visit_id": str(visit_id),
            "customer_id": str(customer_id) if customer_id else None,
        }
