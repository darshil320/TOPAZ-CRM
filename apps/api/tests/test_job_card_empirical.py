"""Empirical: job card data assembly against a real migrated DB.

Proves the two things the pure tests cannot:
  1. PHOTO RESOLUTION ORDER — line override beats the product's chosen catalog
     photo, which beats the product's newest ready reference photo, which beats
     nothing. This is the rule that stops staff re-uploading the same sofa on
     every quotation while still letting a custom piece carry its own shot.
  2. NO MONEY IS SELECTED — the repo's item queries omit price columns entirely,
     so a job card physically cannot leak a price to an outside workshop even if
     a future template tried to print one.

Also covers the workshop recipient list, which drives who receives the sheet.
"""
import asyncio
import os
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.repositories import job_card_repo

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")

_MONEY_COLUMNS = {"unit_price", "line_total", "hsn", "gst_rate", "grand_total", "subtotal"}


def _async_url() -> str:
    return DB_URL.replace("postgresql://", "postgresql+asyncpg://")


def run(coro):
    return asyncio.run(coro)


def _engine():
    return create_async_engine(_async_url(), connect_args={"ssl": False})


async def _customer(session, name="Mrs. Dakshita") -> str:
    consent = (await session.execute(text(
        "insert into consents (face_tracking, personal_data, whatsapp_marketing, method)"
        " values (true, true, true, 'kiosk') returning id"))).scalar_one()
    return (await session.execute(text(
        "insert into customers (consent_id, name) values (:c, :n) returning id"),
        {"c": str(consent), "n": name})).scalar_one()


async def _product(session, name="Dining Top") -> str:
    return (await session.execute(text(
        "insert into products (name, hsn, gst_rate, base_price) "
        "values (:n, '9403', 18, 42000) returning id"), {"n": name})).scalar_one()


async def _media(session, entity_type, entity_id, kind="reference", *,
                 status="ready", thumb=False) -> str:
    mid = uuid4()
    key = f"{entity_type}/{entity_id}/{mid}.jpg"
    await session.execute(text(
        "insert into media (id, entity_type, entity_id, kind, storage_key, thumb_key,"
        " mime, status) values (:id, :et, :eid, :k, :key, :tk, 'image/jpeg', :st)"),
        {"id": str(mid), "et": entity_type, "eid": str(entity_id), "k": kind, "key": key,
         "tk": f"{entity_type}/{entity_id}/{mid}_thumb.jpg" if thumb else None,
         "st": status})
    return str(mid)


async def _order(session, customer_id, *, n_items=1, product_id=None):
    oid = (await session.execute(text(
        "insert into orders (order_no, customer_id, status, expected_delivery_date,"
        " grand_total) values (:no, :c, 'confirmed', :d, 42000) returning id"),
        {"no": f"ORD-T-{uuid4().hex[:8]}", "c": str(customer_id),
         "d": date.today() + timedelta(days=30)})).scalar_one()
    items = []
    for i in range(n_items):
        items.append((await session.execute(text(
            "insert into order_items (order_id, product_id, description, dimensions, qty,"
            " unit, unit_price, hsn, gst_rate, line_total, sort)"
            " values (:o, :p, :d, '78\" x 40\"', 1, 'nos', 42000, '9403', 18, 42000, :s)"
            " returning id"),
            {"o": str(oid), "p": str(product_id) if product_id else None,
             "d": f"Dining Top {i}", "s": i})).scalar_one())
    return oid, items


async def _quotation(session, customer_id, *, product_id=None):
    qid = (await session.execute(text(
        "insert into quotations (quote_no, customer_id, status, valid_until,"
        " place_of_supply, grand_total) values (:no, :c, 'draft', :v, 'GJ', 42000)"
        " returning id"),
        {"no": f"QTN-T-{uuid4().hex[:8]}", "c": str(customer_id),
         "v": date.today() + timedelta(days=15)})).scalar_one()
    item = (await session.execute(text(
        "insert into quotation_items (quotation_id, product_id, description, dimensions,"
        " qty, unit, unit_price, hsn, gst_rate, line_total, sort)"
        " values (:q, :p, 'Dining Top', '78\" x 40\"', 1, 'nos', 42000, '9403', 18, 42000, 0)"
        " returning id"),
        {"q": str(qid), "p": str(product_id) if product_id else None})).scalar_one()
    return qid, item


# ── Photo resolution ────────────────────────────────────────────────────────
def test_line_photo_wins_over_the_catalog_photo():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                prod = await _product(s)
                await _media(s, "product", prod)
                oid, (item_id,) = await _order(s, cust, product_id=prod)
                await _media(s, "order_item", item_id, kind="production")

                card = await job_card_repo.order_job_card(s, oid)
                key = card["items"][0]["photo_key"]
                assert key.startswith(f"order_item/{item_id}/"), key
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_catalog_photo_is_inherited_when_the_line_has_none():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                prod = await _product(s)
                await _media(s, "product", prod)
                oid, (item_id,) = await _order(s, cust, product_id=prod)

                card = await job_card_repo.order_job_card(s, oid)
                assert card["items"][0]["photo_key"].startswith(f"product/{prod}/")
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_primary_media_id_beats_a_newer_reference_photo():
    """An explicitly chosen catalog photo must not be silently replaced by
    whatever was uploaded most recently."""
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                prod = await _product(s)
                chosen = await _media(s, "product", prod)
                await s.execute(text(
                    "update products set primary_media_id = :m where id = :p"),
                    {"m": chosen, "p": str(prod)})
                await _media(s, "product", prod)      # newer, but not primary

                oid, (item_id,) = await _order(s, cust, product_id=prod)
                card = await job_card_repo.order_job_card(s, oid)
                assert chosen in card["items"][0]["photo_key"]
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_pending_and_failed_media_are_never_used():
    """A signed-but-never-uploaded row would render as a broken image."""
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                prod = await _product(s)
                await _media(s, "product", prod, status="pending")
                await _media(s, "product", prod, status="failed")
                oid, (item_id,) = await _order(s, cust, product_id=prod)

                card = await job_card_repo.order_job_card(s, oid)
                assert card["items"][0]["photo_key"] is None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_thumbnail_is_preferred_and_falls_back_to_the_full_image():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_id,) = await _order(s, cust)
                await _media(s, "order_item", item_id, kind="production", thumb=True)
                card = await job_card_repo.order_job_card(s, oid)
                assert card["items"][0]["photo_key"].endswith("_thumb.jpg")

                cust2 = await _customer(s)
                oid2, (item2,) = await _order(s, cust2)
                await _media(s, "order_item", item2, kind="production", thumb=False)
                card2 = await job_card_repo.order_job_card(s, oid2)
                assert not card2["items"][0]["photo_key"].endswith("_thumb.jpg")
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_item_with_no_product_and_no_photo_resolves_to_none():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, (item_id,) = await _order(s, cust)
                card = await job_card_repo.order_job_card(s, oid)
                assert card["items"][0]["photo_key"] is None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ── Money-blindness ─────────────────────────────────────────────────────────
def test_job_card_rows_carry_no_money_columns():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                prod = await _product(s)
                oid, _ = await _order(s, cust, n_items=2, product_id=prod)
                qid, _ = await _quotation(s, cust, product_id=prod)

                for card in (await job_card_repo.order_job_card(s, oid),
                             await job_card_repo.quotation_job_card(s, qid)):
                    for row in card["items"]:
                        leaked = _MONEY_COLUMNS & set(row)
                        assert not leaked, f"job card row leaked money columns: {leaked}"
                    assert _MONEY_COLUMNS & set(card["header"]) == set()
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ── Header + shape ──────────────────────────────────────────────────────────
def test_order_header_carries_the_sheet_fields_and_quotation_has_no_delivery_date():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s, "Mrs. Dakshita")
                oid, _ = await _order(s, cust)
                order_card = await job_card_repo.order_job_card(s, oid)
                assert order_card["header"]["client_name"] == "Mrs. Dakshita"
                assert order_card["header"]["delivery_date"] is not None
                assert order_card["header"]["doc_no"].startswith("ORD-T-")

                qid, _ = await _quotation(s, cust)
                quote_card = await job_card_repo.quotation_job_card(s, qid)
                # A quotation has no committed delivery date — must stay absent.
                assert quote_card["header"]["delivery_date"] is None
                assert quote_card["header"]["doc_no"].startswith("QTN-T-")
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_missing_parent_returns_none_rather_than_raising():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                assert await job_card_repo.order_job_card(s, uuid4()) is None
                assert await job_card_repo.quotation_job_card(s, uuid4()) is None
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_items_keep_sort_order_and_expose_the_product_name():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                prod = await _product(s, "Fluted Dining Base")
                oid, _ = await _order(s, cust, n_items=3, product_id=prod)
                card = await job_card_repo.order_job_card(s, oid)
                assert [r["description"] for r in card["items"]] == [
                    "Dining Top 0", "Dining Top 1", "Dining Top 2"]
                assert card["items"][0]["product_name"] == "Fluted Dining Base"
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ── Workshop recipients ─────────────────────────────────────────────────────
def test_workshop_recipients_are_distinct_active_and_include_a_phoneless_one():
    """A workshop with no manager_phone is still RETURNED so the sender can name
    which one it could not reach — silently sending to 2 of 3 is a support ticket."""
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, items = await _order(s, cust, n_items=3)
                w1 = (await s.execute(text(
                    "insert into workshops (name, manager_phone) values (:n, '+919000000001')"
                    " returning id"), {"n": f"W1-{uuid4().hex[:6]}"})).scalar_one()
                w2 = (await s.execute(text(
                    "insert into workshops (name) values (:n) returning id"),
                    {"n": f"W2-{uuid4().hex[:6]}"})).scalar_one()
                inactive = (await s.execute(text(
                    "insert into workshops (name, active) values (:n, false) returning id"),
                    {"n": f"W3-{uuid4().hex[:6]}"})).scalar_one()

                # Two items at w1 (must dedupe), one at w2, none at the inactive one.
                for item_id, wid in zip(items, (w1, w1, w2)):
                    await s.execute(text(
                        "update order_items set workshop_id = :w where id = :i"),
                        {"w": str(wid), "i": str(item_id)})

                rows = await job_card_repo.workshop_recipients(s, oid)
                ids = {str(r["id"]) for r in rows}
                assert ids == {str(w1), str(w2)}
                assert str(inactive) not in ids
                phoneless = [r for r in rows if r["manager_phone"] is None]
                assert len(phoneless) == 1
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_order_with_no_allocation_has_no_workshop_recipients():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, _ = await _order(s, cust)
                assert await job_card_repo.workshop_recipients(s, oid) == []
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


# ── Review findings, pinned ─────────────────────────────────────────────────
def test_foreign_media_pinned_as_primary_is_never_used_as_a_catalog_photo():
    """security/code-review CRITICAL.

    `products.primary_media_id` is a bare FK to media(id) — the schema alone does
    not stop it aiming at a customer's 'site' photo (a home interior). If the
    resolver honoured that pointer, the photo would be inlined into a job card and
    WhatsApped to an OUTSIDE VENDOR WORKSHOP, defeating both the media_select policy
    and the bucket policy (job card rendering runs on the service-role connection,
    where neither applies). The resolver must require entity_type/entity_id to match.
    """
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                prod = await _product(s)
                # A customer's private home-interior photo…
                foreign = await _media(s, "customer", cust, kind="site")
                # …maliciously or mistakenly pinned as the product's catalog photo.
                await s.execute(text(
                    "update products set primary_media_id = :m where id = :p"),
                    {"m": foreign, "p": str(prod)})

                oid, (item_id,) = await _order(s, cust, product_id=prod)
                card = await job_card_repo.order_job_card(s, oid)
                key = card["items"][0]["photo_key"]
                assert key is None, f"customer photo leaked onto a job card: {key}"
                assert not (key or "").startswith("customer/")
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_quotation_line_photo_override_is_resolved():
    """The quotation-side override branch — previously only order_item was covered."""
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                prod = await _product(s)
                await _media(s, "product", prod)
                qid, item_id = await _quotation(s, cust, product_id=prod)
                await _media(s, "quotation_item", item_id, kind="drawing")

                card = await job_card_repo.quotation_job_card(s, qid)
                assert card["items"][0]["photo_key"].startswith(f"quotation_item/{item_id}/")
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())


def test_item_count_is_cheap_and_correct_for_both_sources():
    async def scenario():
        engine = _engine()
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                cust = await _customer(s)
                oid, _ = await _order(s, cust, n_items=3)
                qid, _ = await _quotation(s, cust)
                assert await job_card_repo.item_count(s, "order", oid) == 3
                assert await job_card_repo.item_count(s, "quotation", qid) == 1
                assert await job_card_repo.item_count(s, "order", uuid4()) == 0
                await s.rollback()
        finally:
            await engine.dispose()
    run(scenario())
