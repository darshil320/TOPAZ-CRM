"""Hourly beat task: remind the floor when a planned stage falls due (0035, REQ 2).

The client's ask was a "popup reminder". Two deliveries, and only one of them lives here:

  * IN-APP — the workshop PWA already gets `stage_due_at` / `stage_overdue` on every
    queue card from GET /api/production/my-queue, and renders a sticky banner plus a
    per-card pill. That needs no task.
  * OUT-OF-APP — this task. A phone that is not open on the queue cannot show a banner,
    so the reminder goes over WhatsApp to the workshop's lead and to the owner.

WEB PUSH IS DELIBERATELY NOT HERE: it needs a service worker, VAPID keys and has iOS
caveats that would sink it on exactly the handsets this app is built for. WhatsApp reaches
the same phone today, and `topaz_production_alert` is ALREADY APPROVED — this whole
requirement therefore ships with no new Meta submission.

─── SINGLE FIRE ─────────────────────────────────────────────────────────────────
`stage_plan_repo.claim_reminder` does `UPDATE … WHERE reminded_at IS NULL RETURNING id`
and the send happens only if a row came back. That claim is what makes an hourly beat
safe: a Celery retry after a partial failure claims nothing and sends nothing. The
failure mode it trades away is a LOST reminder (claimed, then the send failed), which is
strictly better than an hourly nag to a shop floor — a reminder people mute is worse than
no reminder, because they mute the real ones with it.

The `alerts` row is written BEFORE the send and is the durable record: the dashboard
shows the deadline even when WhatsApp is down. The message is the nudge, the alert is the
record — the same split tasks/transit_watchdog.py uses.
"""

import asyncio
import logging

from ..database import make_task_session
from ..repositories import alert_repo, stage_plan_repo, workshop_staff_repo
from ..services import transit_messages
from .celery_app import celery_app

logger = logging.getLogger(__name__)

# One tick's ceiling. A backlog bigger than this is a symptom (the beat stopped, or an
# owner seeded 400 items at once) and draining it in one go would fire hundreds of
# WhatsApps in a minute. The rest are claimed by the next tick, an hour later.
_BATCH = 100

_ALERT_TYPE = "stage_due"


async def _send_template(to: str | None, params: list[dict], *, what: str) -> bool:
    """Fire one approved-template send. A failure never aborts the scan."""
    if not to:
        logger.info("stage reminder: no recipient for %s", what)
        return False
    from .whatsapp import send_wa_template

    try:
        await asyncio.to_thread(
            send_wa_template, to, transit_messages.TEMPLATE_PRODUCTION_ALERT, params
        )
        return True
    except Exception as exc:  # noqa: BLE001 — one bad number must not stop the batch
        logger.warning("stage reminder send failed (%s → %s): %s", what, to, exc)
        return False


def _issue_line(row: dict) -> str:
    """What the recipient reads on the `Issue:` line of `topaz_production_alert`."""
    label = row.get("stage_label_en") or row["stage_code"]
    overdue = transit_messages.overdue_by(row["due_at"])
    prefix = "Blocked — " if row.get("blocked") else ""
    return f"{prefix}Stage '{label}' {overdue}"


async def _remind_one(session, row: dict, *, owner_phone: str | None) -> bool:
    """Claim, record, then send. Returns True if this row was ours to fire."""
    if not await stage_plan_repo.claim_reminder(session, row["id"]):
        return False           # another tick (or another worker) already has it

    detail = (
        f"{row['order_no']} · {row['description']} — "
        f"stage '{row.get('stage_label_en') or row['stage_code']}' due "
        f"{transit_messages.format_ist(row['due_at'])}"
    )
    await alert_repo.create_alert(
        session, customer_id=row["customer_id"], type_=_ALERT_TYPE, detail=detail
    )
    # Commit the claim + the alert BEFORE the network call. A worker killed mid-send must
    # not roll the claim back and re-nag on the next tick.
    await session.commit()

    params = transit_messages.production_alert_params(
        order_no=str(row["order_no"]),
        item_description=str(row["description"]),
        workshop_name=str(row.get("workshop_name") or "Unassigned"),
        issue=_issue_line(row),
        detail=f"Planned finish {transit_messages.format_ist(row['due_at'])}",
    )

    # The floor first: the lead can actually move the work. The owner hears about it too,
    # because a slipping schedule is a commercial problem, not only a production one.
    lead = (
        await workshop_staff_repo.lead_contact(session, row["workshop_id"])
        if row.get("workshop_id") else None
    )
    lead_phone = lead["whatsapp"] if lead else None
    if lead_phone:
        await _send_template(lead_phone, params, what=f"stage_due/lead/{row['order_no']}")
    if owner_phone and owner_phone != lead_phone:
        await _send_template(owner_phone, params, what=f"stage_due/owner/{row['order_no']}")
    return True


async def _run() -> dict:
    async with make_task_session() as session:
        rows = await stage_plan_repo.due_reminders(session, limit=_BATCH)
        if not rows:
            return {"due": 0, "reminded": 0}
        owner_phone = await alert_repo.get_owner_whatsapp(session)

        reminded = 0
        for row in rows:
            try:
                if await _remind_one(session, row, owner_phone=owner_phone):
                    reminded += 1
            except Exception:
                # One bad row (a deleted item mid-scan, a null customer) must not cost
                # the other ninety-nine their reminder.
                logger.exception("Stage reminder failed for plan row %s", row["id"])
                await session.rollback()

    result = {"due": len(rows), "reminded": reminded}
    logger.info("stage reminders: %s", result)
    return result


@celery_app.task(
    bind=True,
    name="src.tasks.stage_reminders.send_stage_reminders",
    max_retries=2,
    default_retry_delay=120,
    acks_late=True,
)
def send_stage_reminders(self) -> dict:
    try:
        return asyncio.run(_run())
    except Exception as exc:
        raise self.retry(exc=exc)
