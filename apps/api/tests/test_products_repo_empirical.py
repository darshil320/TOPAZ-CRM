"""Empirical: product_repo's SQL against the real migrated schema (0053).

Runs only when TEST_DATABASE_URL points at a migrated cluster (pgtest.sh). The route
tests stub the repository; this proves the SQL itself:

  * the PUBLIC read returns the allowlisted columns and nothing else — no price, GST,
    HSN or stock column exists in the row at all — and only for ACTIVE products
  * photos come back cover-first, capped, ready-only, with thumbnails index-aligned
  * create assigns a QR code; update keeps it
  * stock upserts in one statement and leaves unchanged rows untouched
  * sticker rows come back in request order

Every scenario runs in a transaction that is rolled back.
"""
import asyncio
import os
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from src.repositories import product_repo

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")

FORBIDDEN = {"base_price", "gst_rate", "hsn", "stock", "stock_status", "quantity", "location_id", "id"}


def run(scenario):
    async def wrapped():
        engine = create_async_engine(DB_URL.replace("postgresql://", "postgresql+asyncpg://"),
                                     connect_args={"ssl": False})
        try:
            async with engine.connect() as conn:
                trans = await conn.begin()
                try:
                    from sqlalchemy.ext.asyncio import AsyncSession

                    session = AsyncSession(bind=conn)
                    await scenario(session)
                finally:
                    await trans.rollback()
        finally:
            await engine.dispose()

    asyncio.run(wrapped())


async def _locations(session) -> dict[str, str]:
    rows = (await session.execute(text("select code, id from stock_locations"))).all()
    return {code: str(i) for code, i in rows}


async def _create(session, **over) -> dict:
    fields = {"name": "Royal Sofa", "category": "Sofa", "description": "Teak frame",
              "sizes": "3-seater", "dimensions": "84 x 36 x 32 in", "material": "Teak",
              "finish": "Walnut", "hsn": "9401", "gst_rate": 18, "base_price": 42000,
              "unit": "nos", "stock_status": "in_stock", **over}
    return await product_repo.create_product(session, fields)


async def _photo(session, product_id, *, status="ready", thumb=True, age_s=0) -> str:
    mid = uuid4()
    key = f"product/{product_id}/{mid}.jpg"
    await session.execute(text(
        "insert into media (id, entity_type, entity_id, kind, storage_key, thumb_key, mime,"
        " status, created_at) values (:id, 'product', :pid, 'reference', :k, :tk, 'image/jpeg',"
        " :st, now() - make_interval(secs => :age))"),
        {"id": str(mid), "pid": str(product_id), "k": key,
         "tk": key.replace(".jpg", "_thumb.jpg") if thumb else None, "st": status, "age": age_s})
    return key


def test_public_read_is_the_allowlist_and_nothing_else():
    async def scenario(session):
        created = await _create(session)
        row = await product_repo.get_public_by_code(session, created["qr_code"], max_photos=12)
        assert row["name"] == "Royal Sofa" and row["dimensions"] == "84 x 36 x 32 in"
        assert not set(row) & FORBIDDEN
        assert set(row) == {"code", *product_repo.PUBLIC_COLUMNS, "photo_keys", "thumb_keys"}
    run(scenario)


def test_public_read_hides_inactive_products():
    async def scenario(session):
        created = await _create(session)
        await session.execute(text("update products set active = false where id = :id"),
                              {"id": str(created["id"])})
        assert await product_repo.get_public_by_code(session, created["qr_code"], max_photos=12) is None
    run(scenario)


def test_public_photos_are_cover_first_ready_only_capped_and_aligned():
    async def scenario(session):
        created = await _create(session)
        pid = created["id"]
        old = await _photo(session, pid, age_s=300, thumb=False)
        newest = await _photo(session, pid, age_s=0)
        await _photo(session, pid, status="pending")
        cover_key = await _photo(session, pid, age_s=900)
        cover_id = cover_key.rsplit("/", 1)[1].split(".")[0]
        await session.execute(text("update products set primary_media_id = :m where id = :id"),
                              {"m": cover_id, "id": str(pid)})

        row = await product_repo.get_public_by_code(session, created["qr_code"], max_photos=12)
        assert row["photo_keys"] == [cover_key, newest, old]
        assert row["thumb_keys"] == [cover_key.replace(".jpg", "_thumb.jpg"),
                                     newest.replace(".jpg", "_thumb.jpg"), None]

        capped = await product_repo.get_public_by_code(session, created["qr_code"], max_photos=2)
        assert capped["photo_keys"] == [cover_key, newest]
    run(scenario)


def test_update_keeps_the_qr_code():
    async def scenario(session):
        created = await _create(session)
        await product_repo.update_product(session, created["id"], {"name": "Royal Sofa II",
                                                                   "base_price": 45000})
        product = await product_repo.get_product(session, created["id"])
        assert product["qr_code"] == created["qr_code"] and product["name"] == "Royal Sofa II"
    run(scenario)


def test_stock_upsert_sets_each_location_and_skips_unchanged_rows():
    async def scenario(session):
        locs = await _locations(session)
        created = await _create(session)
        pid = created["id"]
        actor = (await session.execute(text(
            "insert into salespersons (name, whatsapp, role) values ('A', :w, 'admin') returning id"),
            {"w": f"+9199{uuid4().int % 10**8:08d}"})).scalar_one()

        await product_repo.upsert_stock(session, pid, {locs["godown"]: 3, locs["bhatar_showroom"]: 1},
                                        actor_id=str(actor))
        assert await product_repo.get_stock(session, pid) == {locs["godown"]: 3, locs["bhatar_showroom"]: 1}

        # ctid moves on every UPDATE, even inside one transaction (where now() — and so
        # updated_at — would not), so it is what proves the row was left alone.
        stamp = (await session.execute(text(
            "select ctid::text from product_stock where product_id = :p and location_id = :l"),
            {"p": str(pid), "l": locs["godown"]})).scalar_one()
        await product_repo.upsert_stock(session, pid, {locs["godown"]: 3, locs["bhatar_showroom"]: 0},
                                        actor_id=str(actor))
        assert await product_repo.get_stock(session, pid) == {locs["godown"]: 3, locs["bhatar_showroom"]: 0}
        unchanged = (await session.execute(text(
            "select ctid::text from product_stock where product_id = :p and location_id = :l"),
            {"p": str(pid), "l": locs["godown"]})).scalar_one()
        assert unchanged == stamp
    run(scenario)


def test_active_locations_are_the_four_seeded():
    async def scenario(session):
        assert len(await product_repo.active_location_ids(session)) == 4
    run(scenario)


def test_sticker_rows_follow_request_order_and_drop_unknown_ids():
    async def scenario(session):
        a = await _create(session, name="A")
        b = await _create(session, name="B")
        rows = await product_repo.sticker_rows(session, [b["id"], uuid4(), a["id"]])
        assert [r["name"] for r in rows] == ["B", "A"]
        assert {"base_price", "gst_rate"}.isdisjoint(rows[0])
    run(scenario)
