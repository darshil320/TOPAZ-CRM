"""Celery tasks for AI follow-up drafting and inbound message routing.

Layer 2 scope:
  - draft_followup: generates a pending_approval message draft in the DB.
    Content is template-based for now; swap in LLM call when budget is confirmed.
  - handle_inbound_reply: logs the inbound message, triggers draft if AI mode active.

The "human-in-the-loop" flow:
  edge REPEAT visit → draft_followup → messages row (draft_status=pending_approval)
  → salesperson sees ⏳ chip in ConversationThread → approves → send_customer_message
"""

import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID

from .celery_app import celery_app
from ..database import make_task_session
from ..repositories.assignment_repo import get_primary_salesperson
from ..repositories.customer_repo import CustomerInfo, get_customer_by_id, get_customer_by_wa_id, touch_last_inbound_at
from ..repositories.message_repo import create_message

logger = logging.getLogger(__name__)


def _draft_body(customer: CustomerInfo, salesperson_name: str | None) -> str:
    """Minimal personalised follow-up template.

    Replace this with an LLM call (e.g. Gemini / OpenAI) once the integration
    is signed off. The DB row is created with draft_status=pending_approval so
    a human reviews it before anything goes to the customer.
    """
    name_greeting = f"Hi {customer.name}," if customer.name else "Hi there,"
    sign = f"— {salesperson_name}" if salesperson_name else "— The Topaz Team"
    return (
        f"{name_greeting}\n\n"
        "It was wonderful having you at our showroom today! "
        "I wanted to personally follow up — did anything catch your eye? "
        "Whether it's a sofa, a full living room set, or something entirely custom, "
        "I'd love to help you find exactly what you're looking for.\n\n"
        "Just reply here and I'll get back to you right away.\n\n"
        f"{sign}"
    )


@celery_app.task(
    bind=True,
    name="src.tasks.ai.draft_followup",
    max_retries=2,
    default_retry_delay=5,
    acks_late=True,
)
def draft_followup(self, customer_id: str, visit_id: str) -> dict:
    """Create a pending_approval AI draft message for a customer visit.

    Only runs if ai_followup_enabled is true on the customer. Idempotent by
    intent but not by constraint — the caller (recognition pipeline) should only
    enqueue this once per visit.
    """
    try:
        return asyncio.run(_draft_followup(UUID(customer_id), UUID(visit_id)))
    except Exception as exc:
        logger.exception("draft_followup failed for customer=%s visit=%s", customer_id, visit_id)
        raise self.retry(exc=exc)


async def _draft_followup(customer_id: UUID, visit_id: UUID) -> dict:
    async with make_task_session() as session:
        customer = await get_customer_by_id(session, customer_id)
        if not customer:
            logger.warning("draft_followup: customer %s not found", customer_id)
            return {"status": "skipped", "reason": "customer_not_found"}

        if not customer.ai_followup_enabled:
            logger.info("draft_followup: AI follow-up disabled for customer %s", customer_id)
            return {"status": "skipped", "reason": "ai_followup_disabled"}

        sp_info = await get_primary_salesperson(session, customer_id)
        salesperson_name: str | None = None
        if sp_info:
            # Fetch salesperson name separately (assignment_repo returns id + whatsapp only)
            from sqlalchemy import text
            row = await session.execute(
                text("SELECT name FROM salespersons WHERE id = :sid"),
                {"sid": str(sp_info[0])},
            )
            r = row.first()
            if r:
                salesperson_name = str(r.name)

        content = _draft_body(customer, salesperson_name)
        message_id = await create_message(
            session,
            customer_id=customer_id,
            direction="outbound",
            content=content,
            sender_type="ai",
            draft_status="pending_approval",
            status="pending",
            ai_generated=True,
        )
        await session.commit()
        logger.info(
            "AI draft created: message=%s customer=%s visit=%s",
            message_id, customer_id, visit_id,
        )
        return {"status": "drafted", "message_id": str(message_id)}


@celery_app.task(
    bind=True,
    name="src.tasks.ai.handle_inbound_reply",
    max_retries=2,
    default_retry_delay=5,
    acks_late=True,
)
def handle_inbound_reply(
    self,
    wa_id: str,
    content: str,
    wamid: str,
    received_at: str,
) -> dict:
    """Log an inbound WhatsApp message and queue an AI draft if appropriate.

    wa_id: customer's number (without +), used to look up the customer row.
    wamid: Meta message id — stored for deduplication.
    """
    try:
        return asyncio.run(_handle_inbound(wa_id, content, wamid, received_at))
    except Exception as exc:
        logger.exception("handle_inbound_reply failed for wa_id=%s wamid=%s", wa_id, wamid)
        raise self.retry(exc=exc)


async def _handle_inbound(wa_id: str, content: str, wamid: str, received_at: str) -> dict:
    async with make_task_session() as session:
        customer = await get_customer_by_wa_id(session, wa_id)
        if not customer:
            logger.warning("handle_inbound: no customer for wa_id=%s", wa_id)
            return {"status": "ignored", "reason": "unknown_wa_id"}

        at = datetime.fromisoformat(received_at).replace(tzinfo=timezone.utc)

        message_id = await create_message(
            session,
            customer_id=customer.id,
            direction="inbound",
            content=content,
            sender_type="customer",
            status="delivered",
            wamid=wamid,
        )
        await touch_last_inbound_at(session, customer.id, at)
        await session.commit()
        logger.info("Inbound logged: message=%s customer=%s", message_id, customer.id)

        # Queue AI draft if the customer is in AI-handler mode and follow-up is enabled.
        if customer.ai_followup_enabled and customer.handler_mode == "ai":
            draft_followup.delay(str(customer.id), "inbound")
            return {"status": "logged_and_queued_draft", "message_id": str(message_id)}

        return {"status": "logged", "message_id": str(message_id)}
