"""Daily beat task: flip soon-due payment schedules to 'due' and queue a
`payment_due` WhatsApp reminder via the existing followup engine (dedupe built
in). payment_due is a UTILITY template — it bypasses the marketing-consent gate
(services/templates + tasks/followup._skip_reason) but still needs a wa_id and a
non-withdrawn consent."""

import asyncio
import logging

from .celery_app import celery_app
from ..config import get_settings
from ..database import make_task_session
from ..repositories import followup_repo, payment_repo

logger = logging.getLogger(__name__)

# Look-ahead window: remind for schedules due within N days.
_REMIND_WITHIN_DAYS = 2


async def _run() -> dict:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    scheduled = 0
    async with make_task_session() as session:
        due = await payment_repo.due_schedules(session, _REMIND_WITHIN_DAYS)
        for d in due:
            followup_id = await followup_repo.schedule_followup(
                session,
                customer_id=d.customer_id,
                template_name="payment_due",
                template_vars={
                    "amount": f"{d.amount:.2f}",
                    "order_no": d.order_no,
                    "due_date": d.due_date.strftime("%d %b %Y"),
                },
                scheduled_at=now,
            )
            if followup_id:
                scheduled += 1
        await session.commit()
    logger.info("payment reminders: %d schedules due, %d followups queued", len(due), scheduled)
    return {"due": len(due), "queued": scheduled}


@celery_app.task(bind=True, name="src.tasks.payment_reminders.send_payment_reminders",
                 max_retries=2, default_retry_delay=60, acks_late=True)
def send_payment_reminders(self) -> dict:
    try:
        return asyncio.run(_run())
    except Exception as exc:
        raise self.retry(exc=exc)
