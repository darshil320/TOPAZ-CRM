"""Celery beat task: close_stale_followups — nightly cadence hygiene (01:00 IST).

Two sweeps:
  1. Recover followups stuck in 'sending' (worker crashed mid-batch) → 'pending'.
  2. Cancel 'pending' followups more than FOLLOWUP_STALE_DAYS past their
     scheduled_at — a message that late reads as spam, not follow-up.
"""

import asyncio
import logging

from .celery_app import celery_app
from ..config import get_settings
from ..database import make_task_session
from ..repositories.followup_repo import cancel_stale_followups, recover_stuck_sending

logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    name="src.tasks.pipeline.close_stale_followups",
    max_retries=1,
    default_retry_delay=60,
    acks_late=True,
)
def close_stale_followups(self) -> dict:
    try:
        return asyncio.run(_close_stale_followups())
    except Exception as exc:
        logger.exception("close_stale_followups failed")
        raise self.retry(exc=exc)


async def _close_stale_followups() -> dict:
    settings = get_settings()
    async with make_task_session() as session:
        recovered = await recover_stuck_sending(session)
        cancelled = await cancel_stale_followups(session, settings.FOLLOWUP_STALE_DAYS)
        await session.commit()

    logger.info(
        "Followup hygiene: recovered_stuck=%d cancelled_stale=%d", recovered, cancelled
    )
    return {"status": "ok", "recovered": recovered, "cancelled": cancelled}
