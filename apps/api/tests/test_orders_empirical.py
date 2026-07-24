"""Empirical: order repo against a real migrated DB (module 04 gate).

Proves: from-quote copies header totals exactly + only from an APPROVED quote +
advance = 50%; manual order totals == gst golden; status transitions optimistic
(legal applies, stale from-status is a no-op).
"""
import asyncio
import os
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import order_repo, quotation_repo
from src.services import gst

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def _async_url() -> str:
    return DB_URL.replace("postgresql://", "postgresql+asyncpg://")


def run(coro):
    return asyncio.run(coro)


async def _customer(session):
    consent = (await session.execute(text(
        "insert into consents (face_tracking, personal_data, whatsapp_marketing, method)"
        " values (true, true, true, 'kiosk') returning id"))).scalar_one()
    return (await session.execute(text(
        "insert into customers (consent_id, name) values (:c, 'Test') returning id"),
        {"c": str(consent)})).scalar_one()


def _items_totals():
    specs = [("Sofa", "1", "1000.00", "18.00", "9401"), ("Table", "1", "2000.00", "5.00", "9403")]
    qi, oi, lines = [], [], []
    for desc, qty, price, rate, hsn in specs:
        lt = gst.compute_line(qty, price).line_total
        qi.append(quotation_repo.QuoteItem(description=desc, qty=Decimal(qty), unit_price=Decimal(price),
                                            hsn=hsn, gst_rate=Decimal(rate), line_total=lt))
        oi.append(order_repo.OrderItem(description=desc, qty=Decimal(qty), unit_price=Decimal(price),
                                       hsn=hsn, gst_rate=Decimal(rate), line_total=lt))
        lines.append(gst.LineInput(qty=Decimal(qty), unit_price=Decimal(price), gst_rate=Decimal(rate)))
    return qi, oi, gst.compute_document(lines, 0, "GJ", "GJ")


def test_from_quote_requires_approved_and_copies_totals():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                qi, _, totals = _items_totals()
                qid = await quotation_repo.create_quotation(
                    s, quote_no=f"QTN-{uuid4().hex[:8]}", customer_id=cust, totals=totals, items=qi)
                # draft quote -> refused
                assert await order_repo.create_from_quote(s, qid, order_no="ORD-X", advance_pct=50) is None
                # approve, then convert
                await s.execute(text("update quotations set status='approved' where id=:id"), {"id": str(qid)})
                oid = await order_repo.create_from_quote(s, qid, order_no=f"ORD-{uuid4().hex[:8]}", advance_pct=50)
                assert oid is not None
                order = await order_repo.get_order(s, oid)
                assert order["grand_total"] == totals.grand_total == Decimal("3280.00")
                assert order["cgst"] == Decimal("140.00") and order["igst"] == Decimal("0.00")
                assert order["advance_expected"] == Decimal("1640.00")  # 50% of 3280
                assert order["status"] == "confirmed"
                assert len(order["items"]) == 2
                assert str(order["quotation_id"]) == str(qid)
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_manual_order_totals_match_golden():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                _, oi, totals = _items_totals()
                oid = await order_repo.create_order(
                    s, order_no=f"ORD-{uuid4().hex[:8]}", customer_id=cust, totals=totals, items=oi)
                order = await order_repo.get_order(s, oid)
                assert order["grand_total"] == Decimal("3280.00")
                assert sum(i["line_total"] for i in order["items"]) == Decimal("3000.00")
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_status_transition_is_optimistic():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                _, oi, totals = _items_totals()
                oid = await order_repo.create_order(
                    s, order_no=f"ORD-{uuid4().hex[:8]}", customer_id=cust, totals=totals, items=oi)
                # legal: confirmed -> in_production
                assert await order_repo.set_status(s, oid, from_status="confirmed", to_status="in_production") is True
                assert await order_repo.get_status(s, oid) == "in_production"
                # stale from-status: no-op
                assert await order_repo.set_status(s, oid, from_status="confirmed", to_status="ready") is False
                # cancel with reason writes an audit row
                assert await order_repo.set_status(
                    s, oid, from_status="in_production", to_status="ready") is True
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())
