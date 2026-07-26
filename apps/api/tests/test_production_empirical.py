"""Empirical: production allocation + the event-stream denorm trigger against a
real migrated DB (module 08 gate).

Proves: allocate() maintains exactly-one-active-assignment and initialises
current_stage (never rewinding it on re-allocation); the partial unique index
order_item_assignments_one_active is the DB backstop even against a raw INSERT
that bypasses the repo; TWO INDEPENDENT sessions racing allocate() on the same
item leave a consistent end state; the media lifecycle repo functions
(create_pending/mark_ready/set_thumb_key) behave as documented, including
idempotent mark_ready; and production_event_apply() only ever does what its
TRIGGER SCOPE FENCE (0024 header) says — advances current_stage monotonically,
sets production_done_at on the last stage without nulling current_stage, flips
orders.status confirmed->in_production->ready gated on ALL items, maintains
blocked/blocked_at without touching stage, never resurrects a cancelled order,
and leaves production_events append-only with one 'done' per stage.

Module 09 owns the insert API for production_events — it does not exist yet,
so these tests insert directly with SQL.
"""
import asyncio
import os
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import media_repo, order_repo, production_repo, workshop_repo
from src.services import gst, media_entities

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def _async_url() -> str:
    return DB_URL.replace("postgresql://", "postgresql+asyncpg://")


def run(coro):
    return asyncio.run(coro)


def _engine():
    return create_async_engine(_async_url(), connect_args={"ssl": False})


async def _customer(session) -> str:
    consent = (await session.execute(text(
        "insert into consents (face_tracking, personal_data, whatsapp_marketing, method)"
        " values (true, true, true, 'kiosk') returning id"))).scalar_one()
    return (await session.execute(text(
        "insert into customers (consent_id, name) values (:c, 'Test') returning id"),
        {"c": str(consent)})).scalar_one()


def _n_order_items(n: int):
    items, lines = [], []
    for i in range(n):
        lt = gst.compute_line("1", "1000.00").line_total
        items.append(order_repo.OrderItem(
            description=f"Item{i}", qty=Decimal("1"), unit_price=Decimal("1000.00"),
            hsn="9401", gst_rate=Decimal("18.00"), line_total=lt, sort=i,
        ))
        lines.append(gst.LineInput(qty=Decimal("1"), unit_price=Decimal("1000.00"), gst_rate=Decimal("18.00")))
    totals = gst.compute_document(lines, 0, "GJ", "GJ")
    return items, totals


async def _order_with_items(session, customer_id, n: int = 1):
    """A confirmed order with n items. Returns (order_id, [item_id, ...]) in sort
    order, so a caller unpacking two items always gets (item_a, item_b) stably."""
    items, totals = _n_order_items(n)
    oid = await order_repo.create_order(
        session, order_no=f"ORD-{uuid4().hex[:8]}", customer_id=customer_id, totals=totals, items=items)
    rows = await session.execute(
        text("select id from order_items where order_id = :o order by sort, id"), {"o": str(oid)})
    return oid, [r[0] for r in rows.all()]


async def _workshop(session, name: str) -> str:
    row = await workshop_repo.create_workshop(session, name=name, type_="own")
    return row["id"]


async def _stage_codes(session) -> list[str]:
    rows = await session.execute(
        text("select code from production_stage_defs where active = true order by sort"))
    return [r[0] for r in rows.all()]


async def _allocate(session, item_id, workshop_id, *, due_date=None):
    await production_repo.lock_item(session, item_id)
    return await production_repo.allocate(
        session, order_item_id=item_id, workshop_id=workshop_id, due_date=due_date, actor_id=None)


async def _item_snapshot(session, item_id) -> dict:
    row = await session.execute(text(
        "select current_stage, current_stage_at, blocked, blocked_at, production_done_at,"
        "       workshop_id from order_items where id = :i"), {"i": str(item_id)})
    return dict(row.mappings().one())


async def _insert_event(session, item_id, stage_code, kind):
    await session.execute(text(
        "insert into production_events (order_item_id, stage_code, kind) values (:i, :st, :k)"),
        {"i": str(item_id), "st": stage_code, "k": kind})


# ── 1. allocate: single active row, denorm initialised ─────────────────────
def test_allocate_creates_one_active_assignment_and_initialises_first_stage():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_id,) = await _order_with_items(s, cust, 1)
                wid = await _workshop(s, f"W-{uuid4().hex[:6]}")
                due = date.today() + timedelta(days=14)
                alloc = await _allocate(s, item_id, wid, due_date=due)

                assert alloc.current_stage == "design_approved"

                rows = (await s.execute(text(
                    "select active, deactivated_at, due_date from order_item_assignments"
                    " where order_item_id = :i"), {"i": str(item_id)})).mappings().all()
                assert len(rows) == 1
                assert rows[0]["active"] is True and rows[0]["deactivated_at"] is None
                assert rows[0]["due_date"] == due

                item = await _item_snapshot(s, item_id)
                assert str(item["workshop_id"]) == str(wid)
                assert item["current_stage"] == "design_approved"
                assert item["current_stage_at"] is not None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ── 2. re-allocate: prior row deactivated, stage NOT rewound ────────────────
def test_reallocate_deactivates_prior_row_and_does_not_rewind_stage():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_id,) = await _order_with_items(s, cust, 1)
                w1 = await _workshop(s, f"W1-{uuid4().hex[:6]}")
                w2 = await _workshop(s, f"W2-{uuid4().hex[:6]}")
                await _allocate(s, item_id, w1)

                # Simulate stage progress so re-allocation has something to rewind
                # (or not): the invariant under test is allocate()'s coalesce.
                await s.execute(text(
                    "update order_items set current_stage = 'cutting', current_stage_at = now()"
                    " where id = :i"), {"i": str(item_id)})

                alloc2 = await _allocate(s, item_id, w2)
                assert alloc2.previous_workshop_id == str(w1)

                rows = (await s.execute(text(
                    "select workshop_id, active, deactivated_at from order_item_assignments"
                    " where order_item_id = :i order by created_at"),
                    {"i": str(item_id)})).mappings().all()
                assert len(rows) == 2
                assert str(rows[0]["workshop_id"]) == str(w1)
                assert rows[0]["active"] is False and rows[0]["deactivated_at"] is not None
                assert str(rows[1]["workshop_id"]) == str(w2)
                assert rows[1]["active"] is True and rows[1]["deactivated_at"] is None

                only_active = (await s.execute(text(
                    "select count(*) from order_item_assignments"
                    " where order_item_id = :i and active = true"),
                    {"i": str(item_id)})).scalar_one()
                assert only_active == 1

                item = await _item_snapshot(s, item_id)
                assert str(item["workshop_id"]) == str(w2)
                assert item["current_stage"] == "cutting"  # NOT rewound to design_approved
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ── 3. raw second active row: partial unique index is the backstop ─────────
def test_raw_insert_of_second_active_assignment_violates_unique_index():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_id,) = await _order_with_items(s, cust, 1)
                w = await _workshop(s, f"W-{uuid4().hex[:6]}")
                await s.execute(text(
                    "insert into order_item_assignments (order_item_id, workshop_id, active)"
                    " values (:i, :w, true)"), {"i": str(item_id), "w": str(w)})
                await s.flush()

                with pytest.raises(IntegrityError):
                    await s.execute(text(
                        "insert into order_item_assignments (order_item_id, workshop_id, active)"
                        " values (:i, :w, true)"), {"i": str(item_id), "w": str(w)})
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ── 4. concurrent allocate: two independent sessions, one invariant ────────
def test_concurrent_allocate_from_two_sessions_leaves_consistent_state():
    async def scenario():
        setup_engine = _engine()
        try:
            async with async_sessionmaker(setup_engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_id,) = await _order_with_items(s, cust, 1)
                w1 = await _workshop(s, f"WA-{uuid4().hex[:6]}")
                w2 = await _workshop(s, f"WB-{uuid4().hex[:6]}")
                await s.commit()
        finally:
            await setup_engine.dispose()

        async def attempt(workshop_id) -> bool:
            engine = _engine()
            try:
                async with async_sessionmaker(engine, expire_on_commit=False)() as sess:
                    await _allocate(sess, item_id, workshop_id)
                    await sess.commit()
                    return True
            except Exception:
                return False
            finally:
                await engine.dispose()

        results = await asyncio.gather(attempt(w1), attempt(w2))
        # Either could win an unlucky ordering, but at least one of two
        # independent, fully-committing callers must succeed.
        assert any(results)

        verify_engine = _engine()
        try:
            async with async_sessionmaker(verify_engine, expire_on_commit=False)() as s:
                active_rows = (await s.execute(text(
                    "select workshop_id from order_item_assignments"
                    " where order_item_id = :i and active = true"),
                    {"i": str(item_id)})).mappings().all()
                assert len(active_rows) == 1
                surviving_workshop = str(active_rows[0]["workshop_id"])

                item_workshop = (await s.execute(text(
                    "select workshop_id from order_items where id = :i"),
                    {"i": str(item_id)})).scalar_one()
                assert str(item_workshop) == surviving_workshop
        finally:
            await verify_engine.dispose()
    run(scenario())


# ── 5-8. media lifecycle (repo functions only, no Pillow/network) ──────────
def test_create_pending_row_matches_build_key_and_starts_unuploaded():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                media_id = uuid4()
                key = media_entities.build_key("customer", cust, media_id, "image/jpeg")
                row = await media_repo.create_pending(
                    s, media_id=media_id, entity_type="customer", entity_id=cust,
                    kind="reference", storage_key=key, mime="image/jpeg", created_by=None)
                assert row["status"] == "pending"
                assert row["uploaded_at"] is None
                assert row["thumb_key"] is None
                assert row["storage_key"] == key
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_mark_ready_flips_status_and_is_idempotent():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                media_id = uuid4()
                key = media_entities.build_key("customer", cust, media_id, "image/jpeg")
                await media_repo.create_pending(
                    s, media_id=media_id, entity_type="customer", entity_id=cust,
                    kind="reference", storage_key=key, mime="image/jpeg", created_by=None)

                first = await media_repo.mark_ready(s, media_id, size_bytes=12345)
                assert first["status"] == "ready"
                assert first["bytes"] == 12345
                assert first["uploaded_at"] is not None

                # Second completion call (flaky-network retry) must be a silent no-op.
                second = await media_repo.mark_ready(s, media_id, size_bytes=99999)
                assert second["status"] == "ready"
                assert second["bytes"] == 12345  # unchanged from the FIRST call

                count = (await s.execute(text(
                    "select count(*) from media where id = :i"), {"i": str(media_id)})).scalar_one()
                assert count == 1  # no duplicate row
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_mark_ready_unknown_id_returns_none_without_raising():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                result = await media_repo.mark_ready(s, uuid4(), size_bytes=1)
                assert result is None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_set_thumb_key_after_ready_is_stored():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                media_id = uuid4()
                key = media_entities.build_key("customer", cust, media_id, "image/jpeg")
                await media_repo.create_pending(
                    s, media_id=media_id, entity_type="customer", entity_id=cust,
                    kind="reference", storage_key=key, mime="image/jpeg", created_by=None)
                ready = await media_repo.mark_ready(s, media_id, size_bytes=100)
                assert ready["thumb_key"] is None  # a real, reachable state pre-thumbnail

                thumb = media_entities.thumb_key_for(key)
                ok = await media_repo.set_thumb_key(s, media_id, thumb)
                assert ok is True

                row = await media_repo.get_media(s, media_id)
                assert row["thumb_key"] == thumb
                assert row["status"] == "ready"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ── 9-12. trigger denorm on a TWO-item order ─────────────────────────────────
def test_done_event_advances_only_that_item_and_flips_order_to_in_production():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_a, item_b) = await _order_with_items(s, cust, 2)
                w = await _workshop(s, f"W-{uuid4().hex[:6]}")
                await _allocate(s, item_a, w)
                await _allocate(s, item_b, w)
                stages = await _stage_codes(s)

                assert await order_repo.get_status(s, oid) == "confirmed"
                before_b = await _item_snapshot(s, item_b)

                await _insert_event(s, item_a, stages[0], "done")

                item_a_row = await _item_snapshot(s, item_a)
                assert item_a_row["current_stage"] == stages[1]
                assert item_a_row["current_stage_at"] is not None

                after_b = await _item_snapshot(s, item_b)
                assert after_b == before_b  # item B completely untouched

                assert await order_repo.get_status(s, oid) == "in_production"

                audit_row = (await s.execute(text(
                    "select 1 from audit_log where entity = 'orders' and entity_id = :o"
                    " and action = 'status:confirmed->in_production'"),
                    {"o": str(oid)})).first()
                assert audit_row is not None  # orders_audit_status fired without error
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_walking_all_stages_sets_production_done_and_order_ready_gates_on_both_items():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_a, item_b) = await _order_with_items(s, cust, 2)
                w = await _workshop(s, f"W-{uuid4().hex[:6]}")
                await _allocate(s, item_a, w)
                await _allocate(s, item_b, w)
                stages = await _stage_codes(s)
                assert len(stages) == 11

                for st in stages:
                    await _insert_event(s, item_a, st, "done")

                item_a_row = await _item_snapshot(s, item_a)
                assert item_a_row["current_stage"] == "dispatch"  # NOT nulled, NOT advanced past
                assert item_a_row["production_done_at"] is not None
                assert await order_repo.get_status(s, oid) == "in_production"  # B unfinished

                for st in stages:
                    await _insert_event(s, item_b, st, "done")

                assert await order_repo.get_status(s, oid) == "ready"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_blocked_unblocked_and_started_do_not_touch_stage():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_id,) = await _order_with_items(s, cust, 1)
                w = await _workshop(s, f"W-{uuid4().hex[:6]}")
                await _allocate(s, item_id, w)
                stages = await _stage_codes(s)
                before = await _item_snapshot(s, item_id)

                await _insert_event(s, item_id, stages[0], "blocked")
                blocked = await _item_snapshot(s, item_id)
                assert blocked["blocked"] is True and blocked["blocked_at"] is not None
                assert blocked["current_stage"] == before["current_stage"]
                assert blocked["current_stage_at"] == before["current_stage_at"]

                await _insert_event(s, item_id, stages[0], "unblocked")
                unblocked = await _item_snapshot(s, item_id)
                assert unblocked["blocked"] is False and unblocked["blocked_at"] is None
                assert unblocked["current_stage"] == before["current_stage"]
                assert unblocked["current_stage_at"] == before["current_stage_at"]

                await _insert_event(s, item_id, stages[0], "started")
                started = await _item_snapshot(s, item_id)
                assert started == unblocked  # 'started' changes nothing at all
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_done_event_on_cancelled_order_does_not_resurrect_status():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_id,) = await _order_with_items(s, cust, 1)
                w = await _workshop(s, f"W-{uuid4().hex[:6]}")
                await _allocate(s, item_id, w)
                stages = await _stage_codes(s)

                await s.execute(text("update orders set status = 'cancelled' where id = :o"),
                                 {"o": str(oid)})

                await _insert_event(s, item_id, stages[0], "done")

                assert await order_repo.get_status(s, oid) == "cancelled"  # not resurrected

                item_row = await _item_snapshot(s, item_id)
                assert item_row["current_stage"] == stages[1]  # item denorm still applied
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ── 13. production_events: append-only + one 'done' per stage ──────────────
def test_production_events_are_append_only_and_done_is_once_per_stage():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_id,) = await _order_with_items(s, cust, 1)
                w = await _workshop(s, f"W-{uuid4().hex[:6]}")
                await _allocate(s, item_id, w)
                stages = await _stage_codes(s)
                first_stage = stages[0]

                inserted = await s.execute(text(
                    "insert into production_events (order_item_id, stage_code, kind)"
                    " values (:i, :st, 'done') returning id"),
                    {"i": str(item_id), "st": first_stage})
                event_id = inserted.scalar_one()
                await s.commit()

                with pytest.raises(Exception):
                    await s.execute(text(
                        "update production_events set note = 'x' where id = :id"),
                        {"id": str(event_id)})
                await s.rollback()

                with pytest.raises(Exception):
                    await s.execute(text(
                        "delete from production_events where id = :id"), {"id": str(event_id)})
                await s.rollback()

                with pytest.raises(Exception):
                    await _insert_event(s, item_id, first_stage, "done")
                await s.rollback()

                remaining = (await s.execute(text(
                    "select count(*) from production_events"
                    " where order_item_id = :i and stage_code = :st and kind = 'done'"),
                    {"i": str(item_id), "st": first_stage})).scalar_one()
                assert remaining == 1
        finally:
            await engine.dispose()
    run(scenario())


# ── 14. 'site' media cannot escape the customer entity (db-review CRITICAL-1) ──
def test_site_media_is_rejected_outside_the_customer_entity():
    """The DB half of the site-scoping rule.

    Both read boundaries — the media_select row policy and the bucket read policy —
    discriminate on entity_type, and the bucket policy sees only the first path
    segment of the key. media_site_is_customer_scoped is what makes entity_type a
    truthful boundary for 'site' photos; without it a home-interior photo attached
    to an order is readable by workshop_manager/delivery.
    """
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_id,) = await _order_with_items(s, cust, 1)

                # Allowed: a site photo of the customer.
                await s.execute(text(
                    "insert into media (entity_type, entity_id, kind, storage_key, mime)"
                    " values ('customer', :id, 'site', :key, 'image/jpeg')"),
                    {"id": str(cust), "key": f"customer/{cust}/{uuid4()}.jpg"})

                # Refused: the same photo filed against the order or the item.
                for entity_type, entity_id in (("order", oid), ("order_item", item_id)):
                    with pytest.raises(Exception):
                        await s.execute(text(
                            "insert into media (entity_type, entity_id, kind, storage_key, mime)"
                            " values (:et, :id, 'site', :key, 'image/jpeg')"),
                            {"et": entity_type, "id": str(entity_id),
                             "key": f"{entity_type}/{entity_id}/{uuid4()}.jpg"})
                    await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())
