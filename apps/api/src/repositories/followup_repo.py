"""Followup repository — cadence queue reads/writes (followups table).

Claiming uses UPDATE … FOR UPDATE SKIP LOCKED so concurrent beat ticks (or a
beat firing while the previous batch is mid-send) never double-send (§19-A.4).
"""

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class ClaimedFollowup:
    id: UUID
    customer_id: UUID
    template_name: str
    template_vars: dict


@dataclass(frozen=True)
class FollowupCustomerContext:
    customer_id: UUID
    name: str | None
    wa_id: str | None
    ai_followup_enabled: bool
    whatsapp_marketing: bool
    consent_withdrawn: bool
    last_inbound_at: datetime | None


async def schedule_followup(
    session: AsyncSession,
    *,
    customer_id: UUID,
    template_name: str,
    template_vars: dict,
    scheduled_at: datetime,
) -> UUID | None:
    """Queue a followup unless the customer already has one pending for this template."""
    existing = await session.execute(
        text(
            "SELECT id FROM followups"
            " WHERE customer_id = :cid AND template_name = :tpl"
            "   AND status IN ('pending', 'sending')"
            " LIMIT 1"
        ),
        {"cid": str(customer_id), "tpl": template_name},
    )
    if existing.first():
        return None

    row = await session.execute(
        text(
            "INSERT INTO followups (customer_id, scheduled_at, template_name, template_vars)"
            " VALUES (:cid, cast(:at AS timestamptz), :tpl, cast(:vars AS jsonb))"
            " RETURNING id"
        ),
        {
            "cid": str(customer_id),
            "at": scheduled_at,
            "tpl": template_name,
            "vars": json.dumps(template_vars),
        },
    )
    return UUID(str(row.scalar_one()))


async def claim_due_followups(
    session: AsyncSession,
    batch_size: int,
) -> list[ClaimedFollowup]:
    """Atomically move due pending followups to 'sending' and return them."""
    result = await session.execute(
        text(
            "UPDATE followups SET status = 'sending', updated_at = now()"
            " WHERE id IN ("
            "   SELECT id FROM followups"
            "   WHERE status = 'pending' AND scheduled_at <= now()"
            "   ORDER BY scheduled_at"
            "   LIMIT :batch"
            "   FOR UPDATE SKIP LOCKED"
            " )"
            " RETURNING id, customer_id, template_name, template_vars"
        ),
        {"batch": batch_size},
    )
    claimed = []
    for row in result.all():
        raw_vars = row.template_vars
        template_vars = raw_vars if isinstance(raw_vars, dict) else json.loads(raw_vars or "{}")
        claimed.append(
            ClaimedFollowup(
                id=UUID(str(row.id)),
                customer_id=UUID(str(row.customer_id)),
                template_name=str(row.template_name),
                template_vars=template_vars,
            )
        )
    return claimed


async def get_followup_customer_context(
    session: AsyncSession,
    customer_id: UUID,
) -> FollowupCustomerContext | None:
    """Customer + consent state needed to decide whether/how to send a followup."""
    result = await session.execute(
        text(
            "SELECT cu.id, cu.name, cu.wa_id, cu.ai_followup_enabled, cu.last_inbound_at,"
            "       co.whatsapp_marketing, co.withdrawn_at"
            " FROM customers cu JOIN consents co ON co.id = cu.consent_id"
            " WHERE cu.id = :cid"
        ),
        {"cid": str(customer_id)},
    )
    row = result.first()
    if not row:
        return None
    return FollowupCustomerContext(
        customer_id=UUID(str(row.id)),
        name=str(row.name) if row.name else None,
        wa_id=str(row.wa_id) if row.wa_id else None,
        ai_followup_enabled=bool(row.ai_followup_enabled),
        whatsapp_marketing=bool(row.whatsapp_marketing),
        consent_withdrawn=row.withdrawn_at is not None,
        last_inbound_at=row.last_inbound_at,
    )


async def mark_followup_sent(session: AsyncSession, followup_id: UUID, task_id: str | None = None) -> None:
    await session.execute(
        text(
            "UPDATE followups SET status = 'sent', celery_task_id = :tid, updated_at = now()"
            " WHERE id = :fid"
        ),
        {"fid": str(followup_id), "tid": task_id},
    )


async def mark_followup_skipped(session: AsyncSession, followup_id: UUID) -> None:
    await session.execute(
        text("UPDATE followups SET status = 'skipped', updated_at = now() WHERE id = :fid"),
        {"fid": str(followup_id)},
    )


async def release_followup(session: AsyncSession, followup_id: UUID) -> None:
    """Return a claimed followup to 'pending' so the next beat tick retries it."""
    await session.execute(
        text("UPDATE followups SET status = 'pending', updated_at = now() WHERE id = :fid"),
        {"fid": str(followup_id)},
    )


async def recover_stuck_sending(session: AsyncSession, older_than_minutes: int = 60) -> int:
    """Re-queue followups stuck in 'sending' (worker crashed mid-batch)."""
    result = await session.execute(
        text(
            "UPDATE followups SET status = 'pending', updated_at = now()"
            " WHERE status = 'sending'"
            "   AND updated_at < now() - make_interval(mins => :mins)"
        ),
        {"mins": older_than_minutes},
    )
    return result.rowcount


async def cancel_stale_followups(session: AsyncSession, stale_days: int) -> int:
    """Cancel pending followups whose scheduled_at is more than stale_days past."""
    result = await session.execute(
        text(
            "UPDATE followups SET status = 'cancelled', updated_at = now()"
            " WHERE status = 'pending'"
            "   AND scheduled_at < now() - make_interval(days => :days)"
        ),
        {"days": stale_days},
    )
    return result.rowcount
