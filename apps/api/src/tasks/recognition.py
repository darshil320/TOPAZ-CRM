"""Celery task: process_recognition_event.

Pipeline (§6.2):
  1. Idempotency — skip if visits.raw_event_id already exists.
  2. Quality gate — reject if quality_score < 0.4.
  3. ANN query — find nearest face embeddings via pgvector HNSW.
  4. Band classification — REPEAT / UNCERTAIN / NEW.
  4.5 REPEAT: look up primary assigned salesperson (needed for visit row + alert).
  5. Write visit row (salesperson_id populated for REPEAT — drives Realtime filter).
  6. REPEAT: enqueue WhatsApp salesperson alert + AI follow-up draft.
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
from ..repositories.assignment_repo import get_primary_salesperson
from ..repositories.customer_repo import get_customer_by_id
from ..repositories.embedding_repo import find_nearest
from ..repositories.visit_repo import create_visit, get_visit_id_by_raw_event_id
from ..services.matching import classify_band
from .whatsapp import send_salesperson_alert
from .ai import draft_followup

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

        # 4.5 For REPEAT visits: look up the primary salesperson before writing
        # the visit row so we can populate salesperson_id on insert. This is
        # what makes the Supabase Realtime subscription in the dashboard work
        # (filter: salesperson_id=eq.<id>).
        sp_info: tuple[UUID, str] | None = None
        salesperson_id: UUID | None = None
        if band == "REPEAT" and customer_id:
            sp_info = await get_primary_salesperson(session, customer_id)
            salesperson_id = sp_info[0] if sp_info else None

        # 5. Write visit + commit.
        visit_id = await create_visit(
            session,
            raw_event_id=raw_event_id,
            match_band=band,
            match_score=top_similarity if top else None,
            customer_id=customer_id,
            photo_key=photo_key,
            salesperson_id=salesperson_id,
        )
        await session.commit()

        # 6. REPEAT — WhatsApp alert to salesperson + queue AI follow-up draft.
        if band == "REPEAT" and customer_id:
            customer_name: str | None = None
            if customer_id:
                customer = await get_customer_by_id(session, customer_id)
                customer_name = customer.name if customer else None

            if sp_info:
                sp_id, sp_whatsapp = sp_info
                send_salesperson_alert.delay(
                    sp_whatsapp,
                    str(customer_id),
                    str(visit_id),
                    customer_name,
                )
                logger.info(
                    "Queued salesperson alert: sp=%s customer=%s visit=%s",
                    sp_id, customer_id, visit_id,
                )
            else:
                logger.info("REPEAT visit: no primary salesperson for customer=%s", customer_id)

            # Queue AI draft only for REPEAT customers (we have their context).
            draft_followup.delay(str(customer_id), str(visit_id))

        # 7. NEW / UNCERTAIN — consent-gated enrollment seam (§19-E).
        # Edge worker must attach a kiosk consent_token to the event before
        # we can persist an embedding or a customer row.
        if band in ("NEW", "UNCERTAIN"):
            # TODO(Layer 3): if event carries consent_token → create_customer + enroll_embedding
            logger.info("band=%s visit=%s — awaiting consent for enrollment", band, visit_id)

        return {
            "status": "processed",
            "band": band,
            "visit_id": str(visit_id),
            "customer_id": str(customer_id) if customer_id else None,
        }
