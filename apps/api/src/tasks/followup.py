"""Celery beat task: send_due_followups — the cadence engine (every 30 min).

Per claimed followup (§ WhatsApp 24h rule):
  - guards: customer exists, has wa_id, whatsapp_marketing consent active,
    ai_followup_enabled — otherwise skipped.
  - inside the 24h service window  → free-form text (template rendered locally).
  - outside the window             → Meta approved-template send.
  - success → messages row (status 'sent') + followup 'sent'.
  - retryable HTTP failure → followup released to 'pending' for the next tick.
  - non-retryable failure  → followup 'skipped' (logged loudly).

Sends run inline (sync httpx) rather than chaining tasks so the claim →
send → record sequence stays observable in one place.
"""

import asyncio
import logging
from datetime import datetime, timezone

import httpx

from .celery_app import celery_app
from .whatsapp import _RETRYABLE_STATUS_CODES, send_wa_template, send_wa_text
from ..config import get_settings
from ..database import make_task_session
from ..repositories.followup_repo import (
    ClaimedFollowup,
    claim_due_followups,
    get_followup_customer_context,
    mark_followup_sent,
    mark_followup_skipped,
    release_followup,
)
from ..repositories.message_repo import create_message
from ..services.templates import FOLLOWUP_TEMPLATES, meta_template_params, render_followup
from ..services.wa_window import within_service_window

logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    name="src.tasks.followup.send_due_followups",
    max_retries=0,
    acks_late=True,
)
def send_due_followups(self) -> dict:
    """Beat entry point — claims and processes one batch of due followups."""
    try:
        return asyncio.run(_send_due_followups())
    except Exception:
        # Beat fires again in 30 min; claimed rows are recovered by
        # recover_stuck_sending in the nightly pipeline task.
        logger.exception("send_due_followups tick failed")
        return {"status": "error"}


async def _send_due_followups() -> dict:
    settings = get_settings()
    async with make_task_session() as session:
        claimed = await claim_due_followups(session, settings.FOLLOWUP_BATCH_SIZE)
        # Commit the claim immediately so a crash mid-batch can't double-send
        # after requeue — stuck 'sending' rows are recovered nightly instead.
        await session.commit()

    if not claimed:
        return {"status": "ok", "claimed": 0}

    counts = {"sent": 0, "skipped": 0, "released": 0}
    # One session (one DB connection) for the whole batch; each followup
    # commits or rolls back independently so one failure can't poison the rest.
    async with make_task_session() as session:
        for followup in claimed:
            try:
                outcome = await _process_one(session, followup)
            except Exception:
                logger.exception("Followup %s crashed — releasing for retry", followup.id)
                await session.rollback()
                try:
                    await release_followup(session, followup.id)
                    await session.commit()
                except Exception:
                    logger.exception(
                        "Could not release followup %s — stays 'sending' until nightly recovery",
                        followup.id,
                    )
                    await session.rollback()
                outcome = "released"
            counts[outcome] += 1

    logger.info(
        "Followup tick: claimed=%d sent=%d skipped=%d released=%d",
        len(claimed), counts["sent"], counts["skipped"], counts["released"],
    )
    return {"status": "ok", "claimed": len(claimed), **counts}


async def _process_one(session, followup: ClaimedFollowup) -> str:
    """Send one followup; returns 'sent' | 'skipped' | 'released'."""
    context = await get_followup_customer_context(session, followup.customer_id)

    skip_reason = _skip_reason(followup, context)
    if skip_reason:
        logger.info("Followup %s skipped: %s", followup.id, skip_reason)
        await mark_followup_skipped(session, followup.id)
        await session.commit()
        return "skipped"

    template_vars = {**followup.template_vars, "name": context.name or ""}
    use_free_form = within_service_window(context.last_inbound_at)

    try:
        if use_free_form:
            content = render_followup(followup.template_name, template_vars)
            wamid = send_wa_text(context.wa_id, content)
            meta_template = None
        else:
            meta_template, params = meta_template_params(followup.template_name, template_vars)
            content = render_followup(followup.template_name, template_vars)
            wamid = send_wa_template(context.wa_id, meta_template, params)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in _RETRYABLE_STATUS_CODES:
            logger.warning(
                "Followup %s send got %s — releasing for retry",
                followup.id, exc.response.status_code,
            )
            await release_followup(session, followup.id)
            await session.commit()
            return "released"
        logger.error(
            "Followup %s send failed permanently (%s): %s",
            followup.id, exc.response.status_code, exc.response.text[:300],
        )
        await mark_followup_skipped(session, followup.id)
        await session.commit()
        return "skipped"
    except httpx.RequestError:
        # AMBIGUOUS SEND: the request may have reached Meta before the
        # connection died — the retry could double-send. Logged distinctly
        # so duplicates are auditable (Cloud API has no idempotency key).
        logger.warning(
            "AMBIGUOUS SEND: followup %s network error — releasing for retry; "
            "a duplicate message to customer %s is possible",
            followup.id, followup.customer_id, exc_info=True,
        )
        await release_followup(session, followup.id)
        await session.commit()
        return "released"

    if wamid is None:
        # WhatsApp not configured (dev) — don't burn the followup, retry later.
        await release_followup(session, followup.id)
        await session.commit()
        return "released"

    await create_message(
        session,
        customer_id=followup.customer_id,
        direction="outbound",
        content=content,
        sender_type="system",
        status="sent",
        wamid=wamid,
        category="marketing",
        template_name=meta_template,
        sent_at=datetime.now(timezone.utc),
    )
    await mark_followup_sent(session, followup.id)
    await session.commit()
    return "sent"


def _skip_reason(followup: ClaimedFollowup, context) -> str | None:
    if context is None:
        return "customer_not_found"
    if followup.template_name not in FOLLOWUP_TEMPLATES:
        return f"unknown_template:{followup.template_name}"
    if not context.wa_id:
        return "no_wa_id"
    if context.consent_withdrawn:
        return "consent_withdrawn"
    if not context.whatsapp_marketing:
        return "no_marketing_consent"
    if not context.ai_followup_enabled:
        return "ai_followup_disabled"
    return None
