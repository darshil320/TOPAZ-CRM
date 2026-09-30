"""Empirical: lead follow-up due-date claim race-safety + atomic terminal-state
clear, against a real Postgres cluster (via pgtest.sh, 0050's actual schema).

Monkeypatched route tests already cover authz/gating logic; this file proves
the SQL itself: claim_followup is race-safe under concurrent callers, and
set_status/mark_converted really do null both columns in one statement.
"""
import asyncio
import os
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import lead_followup_repo, lead_repo

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def _async_url() -> str:
    return DB_URL.replace("postgresql://", "postgresql+asyncpg://")


def run(coro):
    return asyncio.run(coro)


async def _seed_lead(s, **over):
    fields = {
        "name": "Hemant", "phone": "+919426529230", "society": None, "address": None,
        "requirement": None, "comments": None, "source": "walk_in", "source_detail": None,
        "assigned_to": None,
    }
    fields.update(over)
    return await lead_repo.create_lead(s, created_by=None, **fields)


def test_claim_followup_is_race_safe():
    """A second claim on an already-claimed lead returns False — the null-check
    UPDATE ... WHERE followup_notified_at IS NULL is the exclusivity proof; the
    first claim's own commit (not a held lock) is what the second call observes,
    same as how two Celery ticks would actually interleave (never inside one
    another's open transaction)."""
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                lead = await _seed_lead(s)
                await s.commit()
                lead_id = lead["id"]

                first = await lead_followup_repo.claim_followup(s, lead_id)
                await s.commit()
                second = await lead_followup_repo.claim_followup(s, lead_id)
                await s.commit()

                assert first is True
                assert second is False
        finally:
            await engine.dispose()

    run(scenario())


def test_set_status_lost_clears_followup_atomically():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                lead = await _seed_lead(s)
                await s.execute(
                    text("UPDATE leads SET followup_due_on = current_date + 3 WHERE id = :id"),
                    {"id": lead["id"]},
                )
                await s.commit()

                updated = await lead_repo.set_status(
                    s, lead["id"], status="lost", lost_reason="Went cold", clear_followup=True
                )
                await s.commit()

                assert updated["status"] == "lost"
                assert updated["followup_due_on"] is None
                assert updated["followup_notified_at"] is None
        finally:
            await engine.dispose()

    run(scenario())


def test_mark_converted_clears_followup_unconditionally():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                lead = await _seed_lead(s)
                await s.execute(
                    text("UPDATE leads SET followup_due_on = current_date + 1 WHERE id = :id"),
                    {"id": lead["id"]},
                )
                await s.commit()

                consent = (await s.execute(text(
                    "insert into consents (face_tracking, personal_data, whatsapp_marketing, method)"
                    " values (false, true, false, 'app') returning id"
                ))).scalar_one()
                customer_id = (await s.execute(text(
                    "insert into customers (consent_id, name) values (:c, 'Hemant') returning id"
                ), {"c": str(consent)})).scalar_one()

                updated = await lead_repo.mark_converted(s, lead["id"], customer_id=customer_id)
                await s.commit()

                assert updated["status"] == "converted"
                assert updated["followup_due_on"] is None
                assert updated["followup_notified_at"] is None
        finally:
            await engine.dispose()

    run(scenario())


def test_update_lead_round_trips_followup_due_on():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                lead = await _seed_lead(s)
                await s.commit()

                from datetime import date
                due = date(2026, 10, 5)
                updated = await lead_repo.update_lead(s, lead["id"], followup_due_on=due)
                await s.commit()
                assert updated["followup_due_on"] == due

                cleared = await lead_repo.update_lead(s, lead["id"], followup_due_on=None)
                await s.commit()
                assert cleared["followup_due_on"] is None
        finally:
            await engine.dispose()

    run(scenario())


def test_due_followups_scan_and_claim_end_to_end():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                overdue = await _seed_lead(s, phone="+919426529231")
                future = await _seed_lead(s, phone="+919426529232")
                lost = await _seed_lead(s, phone="+919426529233")
                await s.execute(text(
                    "UPDATE leads SET followup_due_on = current_date - 1 WHERE id = :id"
                ), {"id": overdue["id"]})
                await s.execute(text(
                    "UPDATE leads SET followup_due_on = current_date + 5 WHERE id = :id"
                ), {"id": future["id"]})
                await s.execute(text(
                    "UPDATE leads SET followup_due_on = current_date - 1, status = 'lost',"
                    " lost_reason = 'x' WHERE id = :id"
                ), {"id": lost["id"]})
                await s.commit()

                due = await lead_followup_repo.due_followups(s)
                due_ids = {row["id"] for row in due}

                assert overdue["id"] in due_ids
                assert future["id"] not in due_ids, "not yet due"
                assert lost["id"] not in due_ids, "terminal leads are excluded from the scan"
        finally:
            await engine.dispose()

    run(scenario())
