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

─── ONCE PER DAY, UNTIL THE STAGE IS PAST (0045) ────────────────────────────────
The reminder REPEATS: a stage that is overdue and still unfinished is nagged about once
per IST calendar day, and stops the moment the workshop marks that stage done. 0035
originally fired once and never again; the client asked for the repeat, so `reminded_at`
became "when we last nagged" instead of a permanent tombstone.

`stage_plan_repo.claim_reminder` does `UPDATE … WHERE reminded_at < today RETURNING
reminder_count` and the send happens only if a row came back. That conditional claim is
what keeps an HOURLY beat safe under a DAILY rule: the other twenty-three ticks claim
nothing and send nothing, as does a Celery retry after a partial failure. The failure
mode it trades away is one lost day's reminder (claimed, then the send failed) — under
the old rule that lost the reminder outright, now tomorrow's tick asks again.

TWO THINGS STOP THE REPEAT, and both matter:
  * the stage being marked done / the item finishing — the intended, common ending. It
    is a predicate in due_reminders, not a flag anyone has to remember to set.
  * `_MAX_REMINDERS` — the backstop. A nag with no ceiling is how a shop floor learns to
    mute WhatsApp, taking the real alerts with it. After the cap the dashboard `alerts`
    row is the remaining record, and a human is clearly needed anyway.

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

# Repeat ceiling, re-exported from the repository so there is ONE definition. Migration
# 0045's partial index hard-codes the same number in its predicate — if this changes, that
# index must be rebuilt in a new migration or exhausted rows stay in the scan.
_MAX_REMINDERS = stage_plan_repo.MAX_REMINDERS


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


def _issue_line(row: dict, *, nth: int) -> str:
    """What the recipient reads on the `Issue:` line of `topaz_production_alert`.

    `nth` (the post-increment reminder count) is spelled out from the SECOND reminder on.
    A daily repeat that reads identically every morning is indistinguishable from the app
    malfunctioning, and it hides the one fact that should escalate the response: how long
    this has been ignored. The first reminder stays unadorned — "reminder 1 of 14" on a
    stage that is one hour late is noise.
    """
    label = row.get("stage_label_en") or row["stage_code"]
    overdue = transit_messages.overdue_by(row["due_at"])
    prefix = "Blocked — " if row.get("blocked") else ""
    repeat = f" (reminder {nth} of {_MAX_REMINDERS})" if nth > 1 else ""
    return f"{prefix}Stage '{label}' {overdue}{repeat}"


async def _remind_one(session, row: dict, *, owner_phone: str | None) -> bool:
    """Claim, record, then send. Returns True if this row was ours to fire today."""
    nth = await stage_plan_repo.claim_reminder(session, row["id"])
    if nth is None:
        # Already nagged about today by another tick/worker, or the repeat cap is spent.
        # Explicit `is None` rather than falsiness: the count is 1-based post-increment,
        # so it is never 0, but a truthiness check here would be a trap for the next
        # person who changes the counter's base.
        return False

    detail = (
        f"{row['order_no']} · {row['description']} — "
        f"stage '{row.get('stage_label_en') or row['stage_code']}' due "
        f"{transit_messages.format_ist(row['due_at'])}"
    )
    if nth > 1:
        detail = f"{detail} (day {nth} unresolved)"

    # ONE alert row per reminder, deliberately, now that reminders repeat daily. The
    # alternative — updating a single row in place — would erase the history of how many
    # days an item sat overdue, which is precisely the signal the owner is asking the
    # dashboard for. The volume is bounded by _MAX_REMINDERS per stage, and each row's
    # `detail` names the day, so a stale deadline reads as a run of alerts rather than as
    # one alert that quietly aged.
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
        issue=_issue_line(row, nth=nth),
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
