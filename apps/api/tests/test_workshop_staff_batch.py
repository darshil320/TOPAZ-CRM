"""`workshop_staff_repo.list_staff_all` — the batched roster read.

The admin tab renders a roster card per workshop and used to fetch them one HTTP call
at a time, so its load time scaled with the number of workshops. `list_staff_all`
returns every roster from one query.

A batch read replacing a per-item read is only safe if it returns THE SAME ROWS IN THE
SAME ORDER, so that is what these tests assert — the batch is compared against
`list_staff` per workshop rather than against a hand-written expectation, which is the
only comparison that can catch a drift between the two queries later.

Runs via apps/api/scripts/pgtest.sh (skipped without TEST_DATABASE_URL).
"""
import asyncio
import os
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import workshop_staff_repo as staff_repo

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def run(coro):
    return asyncio.run(coro)


def _engine():
    return create_async_engine(
        DB_URL.replace("postgresql://", "postgresql+asyncpg://"), connect_args={"ssl": False}
    )


def _session(engine):
    return async_sessionmaker(engine, expire_on_commit=False)()


async def _workshop(session, name: str) -> UUID:
    row = await session.execute(
        text("insert into workshops (name, type) values (:n, 'own') returning id"), {"n": name}
    )
    return UUID(str(row.scalar_one()))


async def _staffer(session, name: str) -> UUID:
    row = await session.execute(
        text("insert into salespersons (name, whatsapp, role)"
             " values (:n, :w, 'workshop_manager') returning id"),
        {"n": name, "w": f"+9198{uuid4().int % 100_000_000:08d}"},
    )
    return UUID(str(row.scalar_one()))


async def _fixture(session):
    """Two staffed workshops + one with an empty roster + one retired membership."""
    ws_a = await _workshop(session, f"A {uuid4().hex[:6]}")
    ws_b = await _workshop(session, f"B {uuid4().hex[:6]}")
    ws_empty = await _workshop(session, f"Empty {uuid4().hex[:6]}")

    lead_a = await _staffer(session, "Zubin Lead")
    sub_a1 = await _staffer(session, "Arif Sub")
    sub_a2 = await _staffer(session, "Mohan Sub")
    lead_b = await _staffer(session, "Kiran Lead")
    gone = await _staffer(session, "Retired Person")

    await staff_repo.add_staff(session, workshop_id=ws_a, salesperson_id=lead_a,
                              role="lead", actor_id=None)
    await staff_repo.add_staff(session, workshop_id=ws_a, salesperson_id=sub_a1,
                              role="sub", actor_id=None)
    await staff_repo.add_staff(session, workshop_id=ws_a, salesperson_id=sub_a2,
                              role="sub", actor_id=None)
    await staff_repo.add_staff(session, workshop_id=ws_b, salesperson_id=lead_b,
                              role="lead", actor_id=None)
    await staff_repo.add_staff(session, workshop_id=ws_a, salesperson_id=gone,
                              role="sub", actor_id=None)
    await staff_repo.deactivate_membership(session, workshop_id=ws_a, salesperson_id=gone)
    return ws_a, ws_b, ws_empty


def test_batch_matches_per_workshop_exactly():
    """Row-for-row, order included — the batch replaces N calls, so it must be the
    same answer, not merely a similar one."""
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws_a, ws_b, _ = await _fixture(s)
                rosters = await staff_repo.list_staff_all(s, active_only=True)
                for ws in (ws_a, ws_b):
                    one = await staff_repo.list_staff(s, ws, active_only=True)
                    assert rosters[str(ws)] == one, f"batch drifted from list_staff for {ws}"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_lead_first_then_subs_alphabetically():
    """The ordering is what the admin card relies on to show who is in charge."""
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws_a, _, _ = await _fixture(s)
                roster = (await staff_repo.list_staff_all(s, active_only=True))[str(ws_a)]
                assert [r["role"] for r in roster] == ["lead", "sub", "sub"]
                assert [r["salesperson_name"] for r in roster] == [
                    "Zubin Lead", "Arif Sub", "Mohan Sub",
                ]
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_empty_workshop_is_absent_not_an_empty_list():
    """Documented contract: the caller already has the workshop list and renders the
    empty state from it, so the map carries only workshops that have staff."""
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                _, _, ws_empty = await _fixture(s)
                rosters = await staff_repo.list_staff_all(s, active_only=True)
                assert str(ws_empty) not in rosters
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_retired_membership_hidden_unless_asked_for():
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws_a, _, _ = await _fixture(s)
                active = (await staff_repo.list_staff_all(s, active_only=True))[str(ws_a)]
                assert all(r["active"] for r in active)
                assert "Retired Person" not in [r["salesperson_name"] for r in active]

                everyone = (await staff_repo.list_staff_all(s, active_only=False))[str(ws_a)]
                assert "Retired Person" in [r["salesperson_name"] for r in everyone]
                # ...and still matches the per-workshop query in this mode too.
                assert everyone == await staff_repo.list_staff(s, ws_a, active_only=False)
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_rosters_are_not_mixed_between_workshops():
    """The grouping key is the thing that can silently break: a wrong key shows one
    workshop's staff on another's card, which reads as a data-entry mistake."""
    async def scenario():
        engine = _engine()
        try:
            async with _session(engine) as s:
                ws_a, ws_b, _ = await _fixture(s)
                rosters = await staff_repo.list_staff_all(s, active_only=True)
                for ws_id, rows in rosters.items():
                    assert all(str(r["workshop_id"]) == ws_id for r in rows)
                assert len(rosters[str(ws_a)]) == 3
                assert len(rosters[str(ws_b)]) == 1
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())
