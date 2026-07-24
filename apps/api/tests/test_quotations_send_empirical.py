"""Empirical: module 03 send + public approval flow against a real migrated DB.

Proves: draft-only send (idempotent), public summary by token (expired hidden),
approve/reject idempotency (repeat POST = no-op), unknown token -> None, and the
pipeline upsert. Async repo driven via asyncio.run (no pytest-asyncio needed).
"""
import asyncio
import os
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import quotation_repo as repo
from src.services import gst

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def _async_url() -> str:
    return DB_URL.replace("postgresql://", "postgresql+asyncpg://")


def run(coro):
    return asyncio.run(coro)


async def _seed(session):
    consent = (await session.execute(text(
        "insert into consents (face_tracking, personal_data, whatsapp_marketing, method)"
        " values (true, true, true, 'kiosk') returning id"))).scalar_one()
    cust = (await session.execute(text(
        "insert into customers (consent_id, name, wa_id) values (:c, 'Test', '919000000000') returning id"),
        {"c": str(consent)})).scalar_one()
    return cust


def _items_totals():
    specs = [("Sofa", "1", "1000.00", "18.00", "9401"), ("Table", "1", "2000.00", "5.00", "9403")]
    items, lines = [], []
    for desc, qty, price, rate, hsn in specs:
        lt = gst.compute_line(qty, price).line_total
        items.append(repo.QuoteItem(description=desc, qty=Decimal(qty), unit_price=Decimal(price),
                                     hsn=hsn, gst_rate=Decimal(rate), line_total=lt))
        lines.append(gst.LineInput(qty=Decimal(qty), unit_price=Decimal(price), gst_rate=Decimal(rate)))
    return items, gst.compute_document(lines, 0, "GJ", "GJ")


async def _new_quote(s):
    cust = await _seed(s)
    items, totals = _items_totals()
    qid = await repo.create_quotation(s, quote_no=f"QTN-T-{uuid4().hex[:8]}", customer_id=cust,
                                      totals=totals, items=items)
    q = await repo.get_quotation(s, qid)
    return qid, q["approval_token"]


def test_send_is_draft_only_and_idempotent():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                qid, _ = await _new_quote(s)
                await repo.set_pdf_key(s, qid, "quotes/x-r1.pdf")
                assert await repo.mark_sent(s, qid) is True     # draft -> sent
                assert await repo.mark_sent(s, qid) is False    # already sent
                q = await repo.get_quotation(s, qid)
                assert q["status"] == "sent" and q["pdf_key"] == "quotes/x-r1.pdf"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_public_summary_and_viewed_transition():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                qid, token = await _new_quote(s)
                await repo.mark_sent(s, qid)
                summary = await repo.get_public_summary(s, token)
                assert summary is not None
                assert summary["customer_name"] == "Test"
                assert len(summary["items"]) == 2
                # subtotal 3000; tax = 180 (1000@18%) + 100 (2000@5%) = 280; grand 3280
                assert summary["grand_total"] == Decimal("3280.00")
                # first view flips sent -> viewed
                await repo.mark_viewed(s, token)
                assert (await repo.get_status(s, qid)) == "viewed"
                # unknown token -> None
                assert await repo.get_public_summary(s, uuid4()) is None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_expired_quote_hidden_from_public():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                qid, token = await _new_quote(s)
                await repo.soft_delete_draft(s, qid)  # -> expired
                assert await repo.get_public_summary(s, token) is None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_approval_idempotent_and_pipeline_upsert():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                qid, token = await _new_quote(s)
                await repo.mark_sent(s, qid)
                first = await repo.record_decision(s, token, approve=True, ip="1.2.3.4")
                assert first["changed"] is True and first["status"] == "approved"
                await repo.upsert_pipeline_stage(s, first["customer_id"], "order_confirmed")
                # repeat approve = no-op
                second = await repo.record_decision(s, token, approve=True, ip="9.9.9.9")
                assert second["changed"] is False and second["status"] == "approved"
                # reject after approve also no-op (terminal)
                third = await repo.record_decision(s, token, approve=False, ip="9.9.9.9")
                assert third["changed"] is False and third["status"] == "approved"
                stage = (await s.execute(text(
                    "select stage from pipeline_stages where customer_id = :c"),
                    {"c": first["customer_id"]})).scalar_one()
                assert stage == "order_confirmed"
                # unknown token -> None
                assert await repo.record_decision(s, uuid4(), approve=True, ip=None) is None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())
