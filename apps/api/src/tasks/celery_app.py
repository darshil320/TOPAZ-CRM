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
            "send-due-followups": {
                "task": "src.tasks.followup.send_due_followups",
                "schedule": crontab(minute="*/30"),
            },
            "close-stale-followups": {
                "task": "src.tasks.pipeline.close_stale_followups",
                "schedule": crontab(hour=1, minute=0),
            },
        },
    )

    return app


celery_app = create_celery_app()
