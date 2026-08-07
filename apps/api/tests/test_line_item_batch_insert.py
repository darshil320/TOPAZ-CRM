"""Creating a quotation/order costs a CONSTANT number of round-trips.

Quotation creation felt slow because `_insert_items` looped one INSERT per line, and
the router then re-read the record it had just written. Every line item was a separate
network round-trip to Supabase's pooler, so a 40-line quote paid 44 of them
sequentially — invisible on a local socket, ~1s of pure waiting from Railway.

These tests pin the SHAPE that fixed it, because that is what silently regresses: the
obvious way to add a column to a line item is to go back to a per-row loop, and nothing
else in the suite would notice.

  * statement count must not grow with the number of line items
  * the batched INSERT must produce exactly what the per-row loop did — same values,
    same `sort` ordering, same ids/defaults filled in by the database

Runs via apps/api/scripts/pgtest.sh (skipped without TEST_DATABASE_URL).
"""
import asyncio
import os
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import order_repo, quotation_repo
from src.services import gst

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def run(coro):
    return asyncio.run(coro)


class _Counted:
    """An engine that counts the statements it executes."""

    def __init__(self):
        self.engine = create_async_engine(
            DB_URL.replace("postgresql://", "postgresql+asyncpg://"), connect_args={"ssl": False}
        )
        self.count = 0
        event.listen(self.engine.sync_engine, "before_cursor_execute", self._on)

    def _on(self, conn, cursor, statement, parameters, context, executemany):
        self.count += 1

    def session(self):
        return async_sessionmaker(self.engine, expire_on_commit=False)()

    async def dispose(self):
        await self.engine.dispose()


def _quote_items(n: int):
    items, lines = [], []
    for i in range(n):
        lt = gst.compute_line("2", "1500.00").line_total
        items.append(quotation_repo.QuoteItem(
            description=f"Sofa {i}", qty=Decimal("2"), unit_price=Decimal("1500.00"),
            hsn="9401", gst_rate=Decimal("18.00"), line_total=lt,
            dimensions=f"{200 + i}x90", material="teak", fabric="linen",
            polish="matt", customization=None, spec_notes=f"note {i}", unit="nos", sort=i))
        lines.append(gst.LineInput(qty=Decimal("2"), unit_price=Decimal("1500.00"),
                                   gst_rate=Decimal("18.00")))
    return items, gst.compute_document(lines, 0, "GJ", "GJ")


def _order_items(n: int):
    items, lines = [], []
    for i in range(n):
        lt = gst.compute_line("1", "1000.00").line_total
        items.append(order_repo.OrderItem(
            description=f"Table {i}", qty=Decimal("1"), unit_price=Decimal("1000.00"),
            hsn="9403", gst_rate=Decimal("5.00"), line_total=lt,
            dimensions="120x60", material="oak", unit="nos", sort=i))
        lines.append(gst.LineInput(qty=Decimal("1"), unit_price=Decimal("1000.00"),
                                   gst_rate=Decimal("5.00")))
    return items, gst.compute_document(lines, 0, "GJ", "GJ")


async def _customer(session) -> UUID:
    consent = (await session.execute(text(
        "insert into consents (face_tracking, personal_data, whatsapp_marketing, method)"
        " values (true, true, true, 'kiosk') returning id"))).scalar_one()
    cid = (await session.execute(text(
        "insert into customers (consent_id, name) values (:c, 'Batch Test') returning id"),
        {"c": str(consent)})).scalar_one()
    return UUID(str(cid))


def test_quotation_statement_count_does_not_grow_with_line_count():
    async def scenario():
        counts = {}
        for n in (1, 5, 40):
            eng = _Counted()
            try:
                async with eng.session() as s:
                    customer = await _customer(s)
                    await s.commit()
                    items, totals = _quote_items(n)
                    eng.count = 0
                    await quotation_repo.create_quotation_returning(
                        s, quote_no=f"QTN-BATCH-{n}-{uuid4().hex[:6]}", customer_id=customer,
                        totals=totals, items=items, created_by=None)
                    counts[n] = eng.count
                    await s.rollback()
            finally:
                await eng.dispose()
        # One INSERT for the header, one for all the lines. Nothing read back.
        assert counts == {1: 2, 5: 2, 40: 2}, counts
    run(scenario())


def test_order_statement_count_does_not_grow_with_line_count():
    async def scenario():
        counts = {}
        for n in (1, 5, 40):
            eng = _Counted()
            try:
                async with eng.session() as s:
                    customer = await _customer(s)
                    await s.commit()
                    items, totals = _order_items(n)
                    eng.count = 0
                    await order_repo.create_order(
                        s, order_no=f"ORD-BATCH-{n}-{uuid4().hex[:6]}", customer_id=customer,
                        totals=totals, items=items, salesperson_id=None,
                        expected_delivery_date=None, notes=None)
                    counts[n] = eng.count
                    await s.rollback()
            finally:
                await eng.dispose()
        assert counts == {1: 2, 5: 2, 40: 2}, counts
    run(scenario())


def test_batched_rows_match_what_was_asked_for():
    """Every column round-trips, and `sort` decides the order — the batch must not
    reorder or drop a line."""
    async def scenario():
        eng = _Counted()
        try:
            async with eng.session() as s:
                customer = await _customer(s)
                await s.commit()
                items, totals = _quote_items(12)
                created = await quotation_repo.create_quotation_returning(
                    s, quote_no=f"QTN-SHAPE-{uuid4().hex[:6]}", customer_id=customer,
                    totals=totals, items=items, created_by=None)

                got = created["items"]
                assert len(got) == 12
                assert [r["sort"] for r in got] == list(range(12)), "sort order lost"
                for asked, row in zip(items, got):
                    assert row["description"] == asked.description
                    assert Decimal(row["qty"]) == asked.qty
                    assert Decimal(row["unit_price"]) == asked.unit_price
                    assert Decimal(row["line_total"]) == asked.line_total
                    assert row["hsn"] == asked.hsn
                    assert Decimal(row["gst_rate"]) == asked.gst_rate
                    assert row["dimensions"] == asked.dimensions
                    assert row["material"] == asked.material
                    assert row["fabric"] == asked.fabric
                    assert row["polish"] == asked.polish
                    assert row["spec_notes"] == asked.spec_notes
                    assert row["unit"] == asked.unit
                    # Database-supplied, which is why the rows are RETURNED rather
                    # than reconstructed in Python.
                    assert row["id"] is not None
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


def test_returned_record_equals_a_fresh_read():
    """The whole point of skipping the read-back is that it changes nothing. So the
    assembled record must equal what `get_quotation` would have returned."""
    async def scenario():
        eng = _Counted()
        try:
            async with eng.session() as s:
                customer = await _customer(s)
                await s.commit()
                items, totals = _quote_items(7)
                created = await quotation_repo.create_quotation_returning(
                    s, quote_no=f"QTN-EQ-{uuid4().hex[:6]}", customer_id=customer,
                    totals=totals, items=items, created_by=None)
                fetched = await quotation_repo.get_quotation(s, created["id"])
                assert created == fetched
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())


def test_empty_item_list_is_a_no_op_not_a_broken_statement():
    """Guards the `if not items` early return: an empty VALUES list would be a syntax
    error, which is a 500 rather than the 422 the router already raises."""
    async def scenario():
        eng = _Counted()
        try:
            async with eng.session() as s:
                customer = await _customer(s)
                await s.commit()
                _, totals = _quote_items(1)
                created = await quotation_repo.create_quotation_returning(
                    s, quote_no=f"QTN-EMPTY-{uuid4().hex[:6]}", customer_id=customer,
                    totals=totals, items=[], created_by=None)
                assert created["items"] == []
                await s.rollback()
        finally:
            await eng.dispose()
    run(scenario())
