"""Cancelling an order mid-production, against a real migrated DB.

Cancellation used to be legal only from `confirmed`, and the 0024 trigger moves an
order to `in_production` on its first production event — so in practice a customer who
pulled out after work started could not be recorded at all. The order kept advancing
through a pipeline nobody was building.

Widening the transition map is the easy half. These tests cover the half that can
actually hurt:

  * the production machinery is STOOD DOWN in the same transaction — legs cancelled,
    assignments closed, stage-plan reminders skipped. An order cancelled while the
    workshop is still being WhatsApped reminders for it is worse than no feature.
  * goods mid-handover or loaded on an open run BLOCK the cancel, because there is no
    honest way to cancel an order whose custody is in the air.
  * money already taken is REPORTED, never erased. Payments are immutable by trigger;
    cancelling must not pretend the cash never arrived.
  * a cancelled order does not get resurrected by the 0024 denorm trigger.

Runs via apps/api/scripts/pgtest.sh (skipped without TEST_DATABASE_URL).
"""
import asyncio
import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import order_repo
from src.services import gst, order_status

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


async def _customer(session) -> str:
    consent = (await session.execute(text(
        "insert into consents (face_tracking, personal_data, whatsapp_marketing, method)"
        " values (true, true, true, 'kiosk') returning id"))).scalar_one()
    return str((await session.execute(text(
        "insert into customers (consent_id, name) values (:c, 'Cancel Test') returning id"),
        {"c": str(consent)})).scalar_one())


async def _order(session, customer_id: str, *, n_items: int = 2, status: str = "confirmed"):
    items, lines = [], []
    for i in range(n_items):
        lt = gst.compute_line("1", "5000.00").line_total
        items.append(order_repo.OrderItem(
            description=f"Sofa {i}", qty=Decimal("1"), unit_price=Decimal("5000.00"),
            hsn="9401", gst_rate=Decimal("18.00"), line_total=lt, sort=i))
        lines.append(gst.LineInput(qty=Decimal("1"), unit_price=Decimal("5000.00"),
                                   gst_rate=Decimal("18.00")))
    totals = gst.compute_document(lines, 0, "GJ", "GJ")
    order_id = await order_repo.create_order(
        session, order_no=f"ORD-CAN-{uuid4().hex[:8]}", customer_id=UUID(customer_id),
        totals=totals, items=items, salesperson_id=None, expected_delivery_date=None, notes=None)
    if status != "confirmed":
        await session.execute(text("update orders set status = :s where id = :id"),
                              {"s": status, "id": str(order_id)})
    item_ids = [str(r[0]) for r in (await session.execute(
        text("select id from order_items where order_id = :o order by sort"),
        {"o": str(order_id)})).all()]
    return str(order_id), item_ids


async def _workshop(session, name="Cancel WS") -> str:
    return str((await session.execute(text(
        "insert into workshops (name, type) values (:n, 'own') returning id"),
        {"n": f"{name} {uuid4().hex[:6]}"})).scalar_one())


async def _allocate(session, item_id: str, workshop_id: str):
    """An active assignment + an active leg + an unfinished stage plan — the three
    things a cancel has to stand down."""
    await session.execute(text(
        "update order_items set workshop_id = :w, current_stage = 'frame_work',"
        " current_stage_at = now() where id = :i"), {"w": workshop_id, "i": item_id})
    await session.execute(text(
        "insert into order_item_assignments (order_item_id, workshop_id, active, due_at)"
        " values (:i, :w, true, now() + interval '3 days')"), {"i": item_id, "w": workshop_id})
    await session.execute(text(
        "insert into order_item_route_legs (order_item_id, seq, workshop_id, stage_from,"
        " stage_to, status) values (:i, 1, :w, 'frame_work', 'polishing', 'active')"),
        {"i": item_id, "w": workshop_id})
    await session.execute(text(
        "insert into order_item_stage_plan (order_item_id, stage_code, planned_days, due_at)"
        " values (:i, 'frame_work', 2, now() + interval '2 days')"), {"i": item_id})


async def _pay(session, order_id: str, customer_id: str, amount: str):
    await session.execute(text(
        "insert into payments (receipt_no, order_id, customer_id, kind, amount, mode, paid_at)"
        " values (:r, :o, :c, 'advance', :a, 'cash', now())"),
        {"r": f"RCP-CAN-{uuid4().hex[:8]}", "o": order_id, "c": customer_id, "a": Decimal(amount)})


# ─── the map ─────────────────────────────────────────────────────────────────

def test_cancellable_statuses_match_the_service_map():
    assert order_status.CANCELLABLE_FROM == frozenset({"confirmed", "in_production", "ready"})


# ─── standing down production ────────────────────────────────────────────────

@pytest.mark.parametrize("from_status", ["confirmed", "in_production", "ready"])
def test_cancel_stands_down_legs_assignments_and_reminders(from_status):
    async def scenario():
        eng = _engine()
        try:
            async with _session(eng) as s:
                cust = await _customer(s)
                order_id, item_ids = await _order(s, cust, status=from_status)
                ws = await _workshop(s)
                for item in item_ids:
                    await _allocate(s, item, ws)

                state = await order_repo.cancellation_state(s, UUID(order_id))
                assert state["status"] == from_status
                assert int(state["in_transit_items"]) == 0

                assert await order_repo.set_status(
                    s, UUID(order_id), from_status=from_status, to_status="cancelled",
                    reason="Customer changed their mind")
                stood = await order_repo.cancel_open_production(s, UUID(order_id))

                assert stood["legs_cancelled"] == 2
                assert stood["assignments_closed"] == 2
                assert stood["stage_plans_skipped"] == 2

                # And prove it in the tables the workers actually read.
                open_legs = (await s.execute(text(
                    "select count(*) from order_item_route_legs l"
                    " join order_items i on i.id = l.order_item_id"
                    " where i.order_id = :o and l.status in ('pending','in_transit','active')"),
                    {"o": order_id})).scalar_one()
                assert open_legs == 0
                live_assignments = (await s.execute(text(
                    "select count(*) from order_item_assignments a"
                    " join order_items i on i.id = a.order_item_id"
                    " where i.order_id = :o and a.active"), {"o": order_id})).scalar_one()
                assert live_assignments == 0
                pending_plans = (await s.execute(text(
                    "select count(*) from order_item_stage_plan p"
                    " join order_items i on i.id = p.order_item_id"
                    " where i.order_id = :o and p.skipped = false"), {"o": order_id})).scalar_one()
                assert pending_plans == 0
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


def test_finished_stage_plan_rows_are_left_alone():
    """A completed stage is history. Marking it `skipped` would rewrite the record of
    work that actually happened."""
    async def scenario():
        eng = _engine()
        try:
            async with _session(eng) as s:
                cust = await _customer(s)
                order_id, item_ids = await _order(s, cust, n_items=1, status="in_production")
                ws = await _workshop(s)
                item = item_ids[0]
                await _allocate(s, item, ws)
                # A second stage, already completed.
                await s.execute(text(
                    "insert into order_item_stage_plan (order_item_id, stage_code, planned_days,"
                    " due_at) values (:i, 'polishing', 1, now())"), {"i": item})
                await s.execute(text(
                    "insert into production_events (order_item_id, stage_code, kind)"
                    " values (:i, 'polishing', 'done')"), {"i": item})

                stood = await order_repo.cancel_open_production(s, UUID(order_id))
                assert stood["stage_plans_skipped"] == 1, "only the unfinished stage"
                done_untouched = (await s.execute(text(
                    "select skipped from order_item_stage_plan"
                    " where order_item_id = :i and stage_code = 'polishing'"), {"i": item})).scalar_one()
                assert done_untouched is False
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


def test_cancel_is_idempotent_on_the_stand_down():
    """Retrying the stand-down (a retried request, a Celery redelivery) must not
    double-count or error."""
    async def scenario():
        eng = _engine()
        try:
            async with _session(eng) as s:
                cust = await _customer(s)
                order_id, item_ids = await _order(s, cust, n_items=1)
                ws = await _workshop(s)
                await _allocate(s, item_ids[0], ws)

                first = await order_repo.cancel_open_production(s, UUID(order_id))
                second = await order_repo.cancel_open_production(s, UUID(order_id))
                assert first["legs_cancelled"] == 1
                assert second == {"legs_cancelled": 0, "assignments_closed": 0,
                                  "stage_plans_skipped": 0}
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


# ─── blockers ────────────────────────────────────────────────────────────────

def test_item_in_transit_is_reported_as_a_blocker():
    async def scenario():
        eng = _engine()
        try:
            async with _session(eng) as s:
                cust = await _customer(s)
                order_id, item_ids = await _order(s, cust, n_items=1, status="in_production")
                origin, dest = await _workshop(s, "From"), await _workshop(s, "To")
                transfer = (await s.execute(text(
                    "insert into workshop_transfers (transfer_no, from_workshop_id,"
                    " to_workshop_id, status) values (:no, :f, :t, 'in_transit') returning id"),
                    {"no": f"TRF-CAN-{uuid4().hex[:8]}", "f": origin, "t": dest})).scalar_one()
                await s.execute(text(
                    "update order_items set transit_transfer_id = :t where id = :i"),
                    {"t": str(transfer), "i": item_ids[0]})

                state = await order_repo.cancellation_state(s, UUID(order_id))
                assert int(state["in_transit_items"]) == 1
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


def test_item_on_an_open_delivery_is_reported_as_a_blocker():
    async def scenario():
        eng = _engine()
        try:
            async with _session(eng) as s:
                cust = await _customer(s)
                order_id, item_ids = await _order(s, cust, n_items=1, status="ready")
                delivery = (await s.execute(text(
                    "insert into deliveries (order_id, status, scheduled_date)"
                    " values (:o, 'scheduled', current_date) returning id"),
                    {"o": order_id})).scalar_one()
                await s.execute(text(
                    "insert into delivery_items (delivery_id, order_item_id, order_id, customer_id)"
                    " values (:d, :i, :o, :c)"),
                    {"d": str(delivery), "i": item_ids[0], "o": order_id, "c": cust})

                state = await order_repo.cancellation_state(s, UUID(order_id))
                assert int(state["open_delivery_items"]) == 1

                # A COMPLETED run is not a blocker — that order is past cancelling for
                # other reasons, but the count must not fire on history.
                await s.execute(text(
                    "update deliveries set status = 'failed' where id = :d"), {"d": str(delivery)})
                after = await order_repo.cancellation_state(s, UUID(order_id))
                assert int(after["open_delivery_items"]) == 0
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


# ─── money ───────────────────────────────────────────────────────────────────

def test_payments_are_reported_and_survive_the_cancel():
    """The refund the business now owes. Payments are immutable (0016) — cancelling
    must neither erase them nor hide them."""
    async def scenario():
        eng = _engine()
        try:
            async with _session(eng) as s:
                cust = await _customer(s)
                order_id, _ = await _order(s, cust, n_items=1, status="in_production")
                await _pay(s, order_id, cust, "3000.00")

                state = await order_repo.cancellation_state(s, UUID(order_id))
                assert Decimal(str(state["paid"])) == Decimal("3000.00")

                await order_repo.set_status(s, UUID(order_id), from_status="in_production",
                                            to_status="cancelled", reason="Customer withdrew")
                still_there = (await s.execute(text(
                    "select count(*) from payments where order_id = :o"), {"o": order_id})).scalar_one()
                assert still_there == 1
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


def test_refunds_net_off_the_reported_paid_figure():
    async def scenario():
        eng = _engine()
        try:
            async with _session(eng) as s:
                cust = await _customer(s)
                order_id, _ = await _order(s, cust, n_items=1)
                await _pay(s, order_id, cust, "5000.00")
                await s.execute(text(
                    "insert into payments (receipt_no, order_id, customer_id, kind, amount, mode,"
                    " paid_at) values (:r, :o, :c, 'refund', 2000.00, 'bank', now())"),
                    {"r": f"RCP-REF-{uuid4().hex[:8]}", "o": order_id, "c": cust})

                state = await order_repo.cancellation_state(s, UUID(order_id))
                assert Decimal(str(state["paid"])) == Decimal("3000.00")
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


# ─── the status itself ───────────────────────────────────────────────────────

def test_a_cancelled_order_is_not_resurrected_by_a_production_event():
    """0024's denorm trigger is status-guarded. If that guard were ever dropped, a
    workshop tapping Done on a leftover item would silently un-cancel the order."""
    async def scenario():
        eng = _engine()
        try:
            async with _session(eng) as s:
                cust = await _customer(s)
                order_id, item_ids = await _order(s, cust, n_items=1, status="in_production")
                ws = await _workshop(s)
                await s.execute(text(
                    "update order_items set workshop_id = :w, current_stage = 'frame_work'"
                    " where id = :i"), {"w": ws, "i": item_ids[0]})
                await order_repo.set_status(s, UUID(order_id), from_status="in_production",
                                            to_status="cancelled", reason="Customer withdrew")

                await s.execute(text(
                    "insert into production_events (order_item_id, stage_code, kind)"
                    " values (:i, 'frame_work', 'done')"), {"i": item_ids[0]})

                still = (await s.execute(text("select status from orders where id = :o"),
                                         {"o": order_id})).scalar_one()
                assert still == "cancelled"
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


def test_cancel_writes_the_reason_to_the_audit_log():
    async def scenario():
        eng = _engine()
        try:
            async with _session(eng) as s:
                cust = await _customer(s)
                order_id, _ = await _order(s, cust, n_items=1, status="ready")
                await order_repo.set_status(s, UUID(order_id), from_status="ready",
                                            to_status="cancelled",
                                            reason="Site not ready, customer cancelled")
                rows = (await s.execute(text(
                    "select action, payload from audit_log"
                    " where entity = 'orders' and entity_id = :o"), {"o": order_id})).mappings().all()
                actions = {r["action"] for r in rows}
                assert "reason:cancelled" in actions
                reason_row = next(r for r in rows if r["action"] == "reason:cancelled")
                assert "Site not ready" in reason_row["payload"]["reason"]
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


def test_stale_from_status_loses_the_race():
    """Two people cancelling at once: the second must not silently succeed."""
    async def scenario():
        eng = _engine()
        try:
            async with _session(eng) as s:
                cust = await _customer(s)
                order_id, _ = await _order(s, cust, n_items=1, status="in_production")
                assert await order_repo.set_status(
                    s, UUID(order_id), from_status="in_production", to_status="cancelled",
                    reason="First")
                assert not await order_repo.set_status(
                    s, UUID(order_id), from_status="in_production", to_status="cancelled",
                    reason="Second")
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())
