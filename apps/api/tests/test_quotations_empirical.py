"""Empirical: quotation repo against a real migrated DB (module 02 gate).

Proves: server totals stored exactly (== gst golden), revise clones a new numbered
row with the source frozen, and the draft-only guard blocks edit/delete once sent.
Async repo is driven via asyncio.run so no pytest-asyncio is required.
"""
import asyncio
import os
from decimal import Decimal

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


async def _seed_customer(session):
    consent = (await session.execute(text(
        "insert into consents (face_tracking, personal_data, whatsapp_marketing, method)"
        " values (true, true, true, 'kiosk') returning id"))).scalar_one()
    cust = (await session.execute(text(
        "insert into customers (consent_id, name) values (:c, 'Test') returning id"),
        {"c": str(consent)})).scalar_one()
    sp = (await session.execute(text(
        "insert into salespersons (name, whatsapp, role) values ('S','+910000008888','owner') returning id"))).scalar_one()
    return cust, sp


def _mixed_items():
    """3 lines: 1000@18, 2000@5, 500@0 (intra) — subtotal 3500."""
    specs = [
        ("3-seater sofa", "1", "1000.00", "18.00", "9401"),
        ("Dining table", "1", "2000.00", "5.00", "9403"),
        ("Cushion set", "1", "500.00", "0.00", "9404"),
    ]
    items, lines = [], []
    for desc, qty, price, rate, hsn in specs:
        line_total = gst.compute_line(qty, price).line_total
        items.append(repo.QuoteItem(description=desc, qty=Decimal(qty), unit_price=Decimal(price),
                                     hsn=hsn, gst_rate=Decimal(rate), line_total=line_total))
        lines.append(gst.LineInput(qty=Decimal(qty), unit_price=Decimal(price), gst_rate=Decimal(rate)))
    totals = gst.compute_document(lines, 0, "GJ", "GJ")
    return items, totals


async def _session(engine):
    return async_sessionmaker(engine, expire_on_commit=False)()


def test_create_stores_server_totals_matching_golden():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with await _session(engine) as s:
                cust, sp = await _seed_customer(s)
                items, totals = _mixed_items()
                # golden: subtotal 3500, cgst/sgst 140 each, grand 3780
                assert (totals.subtotal, totals.cgst, totals.sgst, totals.grand_total) == (
                    Decimal("3500.00"), Decimal("140.00"), Decimal("140.00"), Decimal("3780.00"))
                qid = await repo.create_quotation(s, quote_no="QTN-TEST-0001", customer_id=cust,
                                                  totals=totals, items=items, created_by=sp)
                got = await repo.get_quotation(s, qid)
                assert got["grand_total"] == Decimal("3780.00")
                assert got["cgst"] == Decimal("140.00") and got["igst"] == Decimal("0.00")
                assert len(got["items"]) == 3
                assert sum(i["line_total"] for i in got["items"]) == Decimal("3500.00")
                assert got["status"] == "draft" and got["approval_token"] is not None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_revise_clones_new_number_and_freezes_source():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with await _session(engine) as s:
                cust, sp = await _seed_customer(s)
                items, totals = _mixed_items()
                qid = await repo.create_quotation(s, quote_no="QTN-TEST-0002", customer_id=cust,
                                                  totals=totals, items=items, created_by=sp)
                new_id = await repo.clone_for_revision(s, qid, new_quote_no="QTN-TEST-0003")
                assert new_id is not None and new_id != qid
                new = await repo.get_quotation(s, new_id)
                old = await repo.get_quotation(s, qid)
                assert str(new["revision_of"]) == str(qid)
                assert new["revision_no"] == old["revision_no"] + 1
                assert new["quote_no"] != old["quote_no"]
                assert new["status"] == "draft"
                assert new["approval_token"] != old["approval_token"]  # fresh token
                assert len(new["items"]) == len(old["items"]) == 3
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_draft_only_guard_blocks_edit_and_delete_once_sent():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with await _session(engine) as s:
                cust, sp = await _seed_customer(s)
                items, totals = _mixed_items()
                qid = await repo.create_quotation(s, quote_no="QTN-TEST-0004", customer_id=cust,
                                                  totals=totals, items=items, created_by=sp)
                # editing a draft succeeds
                assert await repo.update_draft(s, qid, totals=totals, items=items) is True
                # flip to sent, then edit/delete must be refused
                await s.execute(text("update quotations set status='sent' where id=:id"), {"id": str(qid)})
                assert await repo.update_draft(s, qid, totals=totals, items=items) is False
                assert await repo.soft_delete_draft(s, qid) is False
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_soft_delete_draft_expires_it():
    async def scenario():
        engine = create_async_engine(_async_url(), connect_args={"ssl": False})
        try:
            async with await _session(engine) as s:
                cust, sp = await _seed_customer(s)
                items, totals = _mixed_items()
                qid = await repo.create_quotation(s, quote_no="QTN-TEST-0005", customer_id=cust,
                                                  totals=totals, items=items, created_by=sp)
                assert await repo.soft_delete_draft(s, qid) is True
                assert await repo.get_status(s, qid) == "expired"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())
