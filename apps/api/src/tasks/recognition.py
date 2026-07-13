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
from datetime import datetime, timedelta
from uuid import UUID

from .celery_app import celery_app
from ..config import get_settings
from ..database import make_task_session
from ..repositories.assignment_repo import get_primary_salesperson
from ..repositories.customer_repo import get_customer_by_id
from ..repositories.embedding_repo import find_nearest
from ..repositories.enrollment_repo import enroll_face, redeem_consent_customer
from ..repositories.visit_repo import (
    create_visit,
    get_visit_id_by_raw_event_id,
    link_visit_customer,
    recent_repeat_visit_exists,
)
from ..services.matching import classify_band
from .whatsapp import send_salesperson_alert
from .ai import draft_followup

logger = logging.getLogger(__name__)


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
    consent_token: str | None = None,
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
                consent_token=consent_token,
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
    consent_token: str | None = None,
) -> dict:
    async with make_task_session() as session:
        # 1. Idempotency
        existing = await get_visit_id_by_raw_event_id(session, raw_event_id)
        if existing:
            logger.info("raw_event_id %s already processed (visit %s)", raw_event_id, existing)
            return {"status": "duplicate", "visit_id": str(existing)}

        # 2. Quality gate
        settings = get_settings()
        if quality_score < settings.QUALITY_FLOOR:
            logger.info(
                "raw_event_id %s rejected: quality_score %.3f < %.1f",
                raw_event_id,
                quality_score,
                settings.QUALITY_FLOOR,
            )
            return {"status": "rejected", "reason": "quality_too_low"}

        # 3. ANN query
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
            captured_at=captured_at,
        )
        await session.commit()

        # 6. REPEAT — WhatsApp alert to salesperson + queue AI follow-up draft.
        # Failures here are logged, never raised: the visit is already
        # committed, so a task retry would short-circuit at the idempotency
        # gate (step 1) and the alert would silently never be re-attempted.
        if band == "REPEAT" and customer_id:
            try:
                # Throttle: one alert + draft per walk-in session, not per frame.
                # A lingering visitor fires many REPEAT detections (edge cooldown
                # only suppresses near-identical faces); without this, each one
                # would re-alert the salesperson and queue another AI draft.
                alert_since = captured_at - timedelta(minutes=settings.ALERT_COOLDOWN_MINUTES)
                recently_alerted = await recent_repeat_visit_exists(
                    session, customer_id, alert_since, exclude_visit_id=visit_id
                )

                if recently_alerted:
                    logger.info(
                        "REPEAT visit %s within %d-min alert window for customer=%s "
                        "— skipping duplicate alert + draft",
                        visit_id, settings.ALERT_COOLDOWN_MINUTES, customer_id,
                    )
                else:
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
            except Exception:
                logger.exception(
                    "REPEAT post-visit dispatch failed for visit %s — "
                    "salesperson alert / AI draft may be lost",
                    visit_id,
                )

        # 7. NEW / UNCERTAIN — consent-gated enrollment (§19-E).
        # The kiosk created consent + customer; the event's consent_token links
        # this face to that customer. No token → no embedding is ever stored.
        enrolled_customer_id: UUID | None = None
        if band in ("NEW", "UNCERTAIN"):
            if consent_token:
                enrolled_customer_id = await _enroll_with_consent(
                    session,
                    consent_token=consent_token,
                    embedding=embedding,
                    quality_score=quality_score,
                    camera_id=camera_id,
                    visit_id=visit_id,
                )
            else:
                logger.info("band=%s visit=%s — no consent token; not enrolled", band, visit_id)

        return {
            "status": "processed",
            "band": band,
            "visit_id": str(visit_id),
            "customer_id": str(customer_id) if customer_id else None,
            "enrolled_customer_id": str(enrolled_customer_id) if enrolled_customer_id else None,
        }


async def _enroll_with_consent(
    session,
    *,
    consent_token: str,
    embedding: list[float],
    quality_score: float,
    camera_id: str,
    visit_id: UUID,
) -> UUID | None:
    """Redeem a kiosk consent token: store the embedding + link the visit.

    Returns the enrolled customer id, or None when the token is invalid,
    expired, or already redeemed (all logged, never raised — the visit row
    is already committed and must survive).
    """
    try:
        consent_id = UUID(consent_token)
    except ValueError:
        logger.warning("Malformed consent_token on visit %s — ignoring", visit_id)
        return None

    try:
        target_customer_id = await redeem_consent_customer(session, consent_id)
        if target_customer_id is None:
            logger.info(
                "consent_token %s not redeemable (expired/withdrawn/already enrolled) visit=%s",
                consent_id, visit_id,
            )
            return None

        await enroll_face(
            session,
            customer_id=target_customer_id,
            embedding=embedding,
            quality_score=quality_score,
            camera_id=camera_id,
        )
        await link_visit_customer(session, visit_id, target_customer_id)
        await session.commit()
        logger.info(
            "Enrolled face via consent token: customer=%s visit=%s", target_customer_id, visit_id
        )
        return target_customer_id
    except Exception:
        # The face_embedding_consent_gate trigger may reject the insert if
        # consent was withdrawn between redeem and write — that's a safe no-op.
        logger.exception("Consent enrollment failed for visit %s", visit_id)
        await session.rollback()
        return None
