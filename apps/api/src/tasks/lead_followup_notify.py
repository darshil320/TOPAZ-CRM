"""Daily beat task: scan leads whose follow-up is due, create in-app notifications.

Deliberately NOT a WhatsApp send — the user's own words ("not a WhatsApp
notification through Meta, a notification panel on the website"). This is
simpler than stage_reminders.py as a result: scan → claim → insert → commit,
no side-channel step, no per-row network call, no before-send/after-send
commit split.

ONCE PER DUE DATE, NEVER AGAIN, UNTIL MANUALLY CLEARED. Unlike stage_reminders'
daily repeat (0045), a follow-up notification fires exactly once
(leads.followup_notified_at is a plain null-check claim, not a
"reminded_at < today" re-checkable one) — the notification staying visible
in the bell until someone clears it is what gives it permanence; repeating it
would just be noise on top of noise.
"""

import asyncio
import logging

from ..database import make_task_session
from ..repositories import lead_followup_repo
from .celery_app import celery_app

logger = logging.getLogger(__name__)

# One tick's ceiling — same reasoning as stage_reminders' _BATCH, generous here
# since there is no per-row network call to rate-limit.
_BATCH = 200


def _recipient(lead: dict) -> str | None:
    """The assignee is the working owner if set; the creator is the fallback for
    an unassigned lead. A single recipient, not a fan-out to both — matches "my
    leads" scope elsewhere in this feature."""
    return lead.get("assigned_to") or lead.get("created_by")


async def _remind_one(session, lead: dict) -> bool:
    claimed = await lead_followup_repo.claim_followup(session, lead["id"])
    if not claimed:
        # Already claimed by an earlier tick/retry — race-safety, same purpose as
        # stage_plan_repo.claim_reminder, just without the daily-repeat re-check.
        return False

    recipient = _recipient(lead)
    if recipient is None:
        # The claim already consumed the row (followup_notified_at is set), so this
        # lead will not be rescanned. Logged as a data-quality signal — a lead with
        # neither an assignee nor a creator is unusual and worth someone noticing,
        # but must not crash the batch.
        logger.warning(
            "Lead %s has a follow-up due but no assignee or creator to notify", lead["id"]
        )
        return False

    await lead_followup_repo.create_notification(
        session, lead_id=lead["id"], salesperson_id=recipient, due_on=lead["followup_due_on"]
    )
    await session.commit()
    return True


async def _run() -> dict:
    async with make_task_session() as session:
        rows = await lead_followup_repo.due_followups(session, limit=_BATCH)
        if not rows:
            return {"due": 0, "notified": 0}

        notified = 0
        for row in rows:
            try:
                if await _remind_one(session, row):
                    notified += 1
            except Exception:
                # One bad row must not cost the rest of the batch their notification.
                logger.exception("Follow-up notify failed for lead %s", row["id"])
                await session.rollback()

    result = {"due": len(rows), "notified": notified}
    logger.info("lead follow-up notify: %s", result)
    return result


@celery_app.task(
    bind=True,
    name="src.tasks.lead_followup_notify.scan_due_followups",
    max_retries=2,
    default_retry_delay=120,
    acks_late=True,
)
def scan_due_followups(self) -> dict:
    try:
        return asyncio.run(_run())
    except Exception as exc:
        raise self.retry(exc=exc)
