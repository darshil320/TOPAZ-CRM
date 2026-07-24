"""Empirical: payments against a real migrated DB (module 05 gate — money).

Proves: payments are IMMUTABLE (UPDATE/DELETE raise), order_outstanding nets
refunds, a covering payment flips the earliest schedule to 'paid', and
due_schedules moves pending->due within the window.
"""
import asyncio
import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import order_repo, payment_repo
from src.services import gst

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def _async_url() -> str:
    return DB_URL.replace("postgresql://", "postgresql+asyncpg://")


def run(coro):
    return asyncio.run(coro)


async def _order(session) -> tuple:
    consent = (await session.execute(text(
        "insert into consents (face_tracking, personal_data, whatsapp_marketing, method)"
        " values (true, true, true, 'kiosk') returning id"))).scalar_one()
    cust = (await session.execute(text(
        "insert into customers (consent_id, name) values (:c, 'Test') returning id"),
        {"c": str(consent)})).scalar_one()
    lines = [gst.LineInput(qty=Decimal("1"), unit_price=Decimal("10000.00"), gst_rate=Decimal("18.00"))]
    totals = gst.compute_document(lines, 0, "GJ", "GJ")
    items = [order_repo.OrderItem(description="Wardrobe", qty=Decimal("1"),
                                  unit_price=Decimal("10000.00"), hsn="9403",
                                  gst_rate=Decimal("18.00"), line_total=Decimal("10000.00"))]
    oid = await order_repo.create_order(session, order_no=f"ORD-{uuid4().hex[:8]}",
                                        customer_id=cust, totals=totals, items=items)
    return oid, str(cust)


def _engine():
    return create_async_engine(_async_url(), connect_args={"ssl": False})


def test_payment_is_immutable():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                oid, cust = await _order(s)
                pid = await payment_repo.record_payment(
                    s, receipt_no=f"RCP-{uuid4().hex[:8]}", order_id=oid, customer_id=cust,
                    kind="advance", amount=Decimal("5000.00"), mode="upi",
                    paid_at=datetime.now(timezone.utc))
                await s.commit()
                # UPDATE blocked by the immutability trigger
                with pytest.raises(Exception):
                    await s.execute(text("UPDATE payments SET amount = 1 WHERE id = :id"), {"id": str(pid)})
                await s.rollback()
                with pytest.raises(Exception):
                    await s.execute(text("DELETE FROM payments WHERE id = :id"), {"id": str(pid)})
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_outstanding_nets_refund():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                oid, cust = await _order(s)  # grand 11800
                await payment_repo.record_payment(
                    s, receipt_no=f"RCP-{uuid4().hex[:8]}", order_id=oid, customer_id=cust,
                    kind="advance", amount=Decimal("6000.00"), mode="cash",
                    paid_at=datetime.now(timezone.utc))
                await payment_repo.record_payment(
                    s, receipt_no=f"RCP-{uuid4().hex[:8]}", order_id=oid, customer_id=cust,
                    kind="refund", amount=Decimal("1000.00"), mode="cash",
                    paid_at=datetime.now(timezone.utc))
                grand, paid = await payment_repo.order_totals(s, oid)
                assert grand == Decimal("11800.00")
                assert paid == Decimal("5000.00")  # 6000 - 1000 refund
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_covering_payment_flips_earliest_schedule():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                oid, cust = await _order(s)
                await payment_repo.replace_schedule(s, oid, [
                    payment_repo.ScheduleRow(label="Advance", due_date=date.today(), amount=Decimal("5000.00")),
                    payment_repo.ScheduleRow(label="Balance", due_date=date.today() + timedelta(days=30), amount=Decimal("6800.00")),
                ])
                await payment_repo.record_payment(
                    s, receipt_no=f"RCP-{uuid4().hex[:8]}", order_id=oid, customer_id=cust,
                    kind="advance", amount=Decimal("5000.00"), mode="upi",
                    paid_at=datetime.now(timezone.utc))
                await payment_repo.mark_earliest_schedule_paid(s, oid, Decimal("5000.00"))
                statuses = (await s.execute(text(
                    "select status from payment_schedules where order_id = :o order by due_date"),
                    {"o": str(oid)})).scalars().all()
                assert statuses == ["paid", "pending"]
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_due_schedules_flips_pending_to_due():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                oid, _ = await _order(s)
                await payment_repo.replace_schedule(s, oid, [
                    payment_repo.ScheduleRow(label="Soon", due_date=date.today() + timedelta(days=1), amount=Decimal("100.00")),
                    payment_repo.ScheduleRow(label="Later", due_date=date.today() + timedelta(days=30), amount=Decimal("200.00")),
                ])
                due = await payment_repo.due_schedules(s, within_days=2)
                assert len(due) == 1 and due[0].order_id == oid
                # the flagged one is now 'due', the far one still 'pending'
                statuses = (await s.execute(text(
                    "select status from payment_schedules where order_id = :o order by due_date"),
                    {"o": str(oid)})).scalars().all()
                assert statuses == ["due", "pending"]
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())
