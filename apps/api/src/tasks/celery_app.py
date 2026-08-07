"""Celery application factory.

Beat schedule handles cadence; individual task modules register themselves.
acks_late=True + reject_on_worker_lost=True: tasks are re-queued if the
worker crashes mid-flight (prevents silent loss on OOM/restart).
"""

from celery import Celery
from celery.schedules import crontab

from ..config import get_settings


def create_celery_app() -> Celery:
    settings = get_settings()

    app = Celery(
        "topaz",
        broker=settings.REDIS_URL,
        backend=settings.REDIS_URL,
        include=[
            "src.tasks.recognition",
            "src.tasks.whatsapp",
            "src.tasks.ai",
            "src.tasks.followup",
            "src.tasks.pipeline",
            "src.tasks.pdf",
            "src.tasks.quotes",
            "src.tasks.receipts",
            "src.tasks.payment_reminders",
            "src.tasks.media",
            "src.tasks.job_card",
            "src.tasks.production_notify",
            "src.tasks.transit_watchdog",
            "src.tasks.stage_reminders",
            "src.tasks.challan",
        ],
    )

    app.conf.update(
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="Asia/Kolkata",
        enable_utc=True,
        beat_schedule={
            # EVERY 5 MIN, not every 30. The welcome is scheduled 10 minutes after a
            # kiosk enrollment (WELCOME_FOLLOWUP_DELAY_MINUTES) and a beat can only send
            # a followup on a tick — at */30 a "10 minute" welcome actually landed
            # anywhere from 10 to 40 minutes later, which is the wrong side of a customer
            # walking out. */5 bounds that overshoot to 5 minutes.
            #
            # Cost of the tighter cadence is one indexed claim query per tick against an
            # empty result set for most ticks (claim_due_followups is LIMIT-bounded and
            # returns immediately when nothing is due), not 6x the sends — the batch is
            # claimed exactly once either way.
            "send-due-followups": {
                "task": "src.tasks.followup.send_due_followups",
                "schedule": crontab(minute="*/5"),
            },
            "close-stale-followups": {
                "task": "src.tasks.pipeline.close_stale_followups",
                "schedule": crontab(hour=1, minute=0),
            },
            "payment-reminders": {
                "task": "src.tasks.payment_reminders.send_payment_reminders",
                "schedule": crontab(hour=10, minute=0),  # daily 10:00 IST (timezone set above)
            },
            # 09:00 IST, BEFORE the payment reminder: a manager reads the first message
            # of the day, and a missed production deadline is the one they can still act
            # on today. Once daily, not hourly — the dedupe key is per-day, so a tighter
            # cadence would only re-scan without ever alerting twice.
            "transit-watchdog": {
                "task": "src.tasks.transit_watchdog.scan_production_delays",
                "schedule": crontab(hour=9, minute=0),
            },
            # STILL HOURLY, even though the reminder itself is now once-per-day (0045).
            # The two cadences do different jobs: the DAILY rule is the anti-nag limit,
            # the HOURLY beat is the latency. A stage deadline lands at 18:00 IST on a
            # specific day, and the first reminder should follow within the hour rather
            # than waiting for a fixed morning slot — that first message is the one that
            # can still save the day. Every subsequent tick that day claims nothing,
            # because the claim's dedupe key is the IST calendar day
            # (stage_plan_repo._IST_TODAY_START), so the repeat lands early the next
            # morning and once more each day until the stage is marked done.
            "stage-reminders": {
                "task": "src.tasks.stage_reminders.send_stage_reminders",
                "schedule": crontab(minute=5),
            },
        },
    )

    return app


celery_app = create_celery_app()
