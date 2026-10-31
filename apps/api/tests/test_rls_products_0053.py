"""0053 RLS proof — QR product tags + multi-location stock. Runs on the temp DB via
pgtest.sh.

The customer boundary is the release-blocking part: a customer has no login, so to the
database they are `anon`, and anon must reach NO price, GST, HSN, stock or location —
not with today's grants, and not even if Supabase's blanket "anon gets ALL" bootstrap
grant (0034) were ever re-applied (RLS / the view gate must still return nothing).

Staff, "according to their permissions":
  - price/GST/HSN via product_prices: sellers and billers yes; workshop_manager and
    delivery no
  - stock + locations: every active staff role
  - stock is written only through the API (service role) — no browser write path
  - the QR code is assigned on insert, well-formed, unique, and never changes

The pending 0054 (column lockdown) is applied inside a rolled-back transaction, so its
behaviour is proven before it is promoted.
"""
import contextlib
import json
import re
from pathlib import Path

import psycopg2
import pytest
from tests.rls_support import DB_URL, as_anon, as_owner, as_role, as_service, as_sp1, seed_db

ADMIN_ID, ADMIN_UID = "10000000-0000-0000-0000-0000000000e1", "a0000000-0000-0000-0000-0000000000e1"
WM_ID, WM_UID = "10000000-0000-0000-0000-0000000000e2", "a0000000-0000-0000-0000-0000000000e2"
DRV_ID, DRV_UID = "10000000-0000-0000-0000-0000000000e3", "a0000000-0000-0000-0000-0000000000e3"
ACC_ID, ACC_UID = "10000000-0000-0000-0000-0000000000e4", "a0000000-0000-0000-0000-0000000000e4"
PRODUCT = "60000000-0000-0000-0000-0000000000e1"

QR_FORMAT = re.compile(r"^[0-9A-HJKMNP-TV-Z]{8}$")
PENDING_0054 = (
    Path(__file__).resolve().parents[3]
    / "supabase/migrations_pending/0054_products_price_columns_staff_only.sql"
)
PRICE_COLUMNS = {"base_price", "gst_rate", "hsn"}


def _seed():
    seed_db()
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        for sid, uid, name, wa, role in (
            (ADMIN_ID, ADMIN_UID, "Admin", "+910000000031", "admin"),
            (WM_ID, WM_UID, "Workshop", "+910000000032", "workshop_manager"),
            (DRV_ID, DRV_UID, "Driver", "+910000000033", "delivery"),
            (ACC_ID, ACC_UID, "Accounts", "+910000000034", "accounts"),
        ):
            cur.execute("insert into salespersons (id, auth_uid, name, whatsapp, role) "
                        "values (%s,%s,%s,%s,%s)", (sid, uid, name, wa, role))
        cur.execute("delete from products where id = %s", (PRODUCT,))
        cur.execute(
            "insert into products (id, name, category, base_price, gst_rate, hsn, description)"
            " values (%s, 'Royal Sofa', 'Sofa', 42000, 18, '9401', 'Teak frame')",
            (PRODUCT,),
        )
        cur.execute(
            "insert into product_stock (product_id, location_id, quantity)"
            " select %s, id, 3 from stock_locations where code = 'godown'",
            (PRODUCT,),
        )
    conn.close()


@pytest.fixture(autouse=True)
def seeded():
    _seed()


def as_admin():
    return as_role("authenticated", ADMIN_UID)


def as_workshop():
    return as_role("authenticated", WM_UID)


def as_driver():
    return as_role("authenticated", DRV_UID)


def as_accounts():
    return as_role("authenticated", ACC_UID)


@contextlib.contextmanager
def as_anon_with_supabase_bootstrap_grants():
    """anon as it would be if Supabase's stock "GRANT ALL ON ALL TABLES TO anon" were
    re-applied over 0053's revokes — proves layer 2 (RLS / view gate) on its own. The
    GRANT is transactional and rolled back with everything else."""
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("grant select on products, product_stock, stock_locations,"
                " product_prices, product_categories to anon")
    cur.execute("set local role anon")
    cur.execute("set local request.jwt.claims = %s", (json.dumps({"role": "anon"}),))
    try:
        yield cur
    finally:
        conn.rollback()
        cur.close()
        conn.close()


@contextlib.contextmanager
def with_0054(auth_uid):
    """Apply the pending 0054 as the migration owner, then act as a staff JWT. Rolled
    back, so the shared temp DB keeps 0053's grants for every other test."""
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute(PENDING_0054.read_text())
    cur.execute("set local role authenticated")
    cur.execute("set local request.jwt.claims = %s",
                (json.dumps({"role": "authenticated", "sub": auth_uid}),))
    try:
        yield cur
    finally:
        conn.rollback()
        cur.close()
        conn.close()


# ─── The customer boundary ──────────────────────────────────────────────────

@pytest.mark.parametrize("relation", [
    "products", "product_stock", "stock_locations", "product_prices", "product_categories",
])
def test_anon_has_no_privilege_on_any_catalog_relation(relation):
    with as_anon() as cur, pytest.raises(psycopg2.errors.InsufficientPrivilege):
        cur.execute(f"select * from {relation}")


@pytest.mark.parametrize("relation", ["products", "product_stock", "stock_locations", "product_prices"])
def test_anon_sees_nothing_even_if_the_bootstrap_grant_returned(relation):
    with as_anon_with_supabase_bootstrap_grants() as cur:
        cur.execute(f"select count(*) from {relation}")
        assert cur.fetchone()[0] == 0


def test_anon_cannot_call_the_code_generator():
    with as_anon() as cur, pytest.raises(psycopg2.errors.InsufficientPrivilege):
        cur.execute("select new_product_qr_code()")


# A customer can hold an AUTHENTICATED JWT with no staff row: phone-OTP login creates
# an auth user for any number. To the catalog they must be no different from anon.
CUSTOMER_UID = "a0000000-0000-0000-0000-0000000000ef"


@pytest.mark.parametrize("relation", [
    "products", "product_stock", "stock_locations", "product_prices", "product_categories",
])
def test_signed_in_non_staff_sees_nothing(relation):
    with as_role("authenticated", CUSTOMER_UID) as cur:
        cur.execute(f"select count(*) from {relation}")
        assert cur.fetchone()[0] == 0


def test_signed_in_non_staff_cannot_read_a_price_column():
    with as_role("authenticated", CUSTOMER_UID) as cur:
        cur.execute("select base_price from products where id = %s", (PRODUCT,))
        assert cur.fetchall() == []


def test_deactivated_staff_lose_the_catalog():
    with as_service() as cur:
        cur.execute("update salespersons set active = false where id = %s", (WM_ID,))
        cur.execute("set local role authenticated")
        cur.execute("set local request.jwt.claims = %s",
                    (json.dumps({"role": "authenticated", "sub": WM_UID}),))
        cur.execute("select count(*) from products")
        assert cur.fetchone()[0] == 0


# ─── Staff: prices by permission ────────────────────────────────────────────

@pytest.mark.parametrize("persona", [as_owner, as_admin, as_sp1, as_accounts])
def test_sellers_and_billers_read_prices(persona):
    with persona() as cur:
        cur.execute("select base_price, gst_rate, hsn from product_prices where product_id = %s",
                    (PRODUCT,))
        assert cur.fetchone() == (42000, 18, "9401")


@pytest.mark.parametrize("persona", [as_workshop, as_driver])
def test_workshop_and_delivery_get_no_prices(persona):
    with persona() as cur:
        cur.execute("select count(*) from product_prices")
        assert cur.fetchone()[0] == 0


# ─── Staff: stock + locations ───────────────────────────────────────────────

@pytest.mark.parametrize("persona", [as_owner, as_sp1, as_workshop, as_driver, as_accounts])
def test_every_staff_role_reads_stock_and_locations(persona):
    with persona() as cur:
        cur.execute(
            "select l.code, s.quantity from product_stock s"
            " join stock_locations l on l.id = s.location_id where s.product_id = %s",
            (PRODUCT,),
        )
        assert cur.fetchall() == [("godown", 3)]


def test_the_four_locations_are_seeded_in_order():
    with as_sp1() as cur:
        cur.execute("select name from stock_locations order by sort")
        assert [r[0] for r in cur.fetchall()] == [
            "Bhatar Showroom", "Ichhapore Showroom", "Godown", "Workshop",
        ]


@pytest.mark.parametrize("persona", [as_owner, as_admin])
def test_no_browser_write_path_for_stock(persona):
    with persona() as cur, pytest.raises(psycopg2.errors.InsufficientPrivilege):
        cur.execute("update product_stock set quantity = 99 where product_id = %s", (PRODUCT,))


def test_stock_quantity_cannot_go_negative():
    with as_service() as cur, pytest.raises(psycopg2.errors.CheckViolation):
        cur.execute("update product_stock set quantity = -1 where product_id = %s", (PRODUCT,))


# ─── QR code ────────────────────────────────────────────────────────────────

def test_qr_code_is_assigned_on_insert_and_well_formed():
    with as_service() as cur:
        cur.execute("insert into products (name) select 'P' || g from generate_series(1, 200) g"
                    " returning qr_code")
        codes = [r[0] for r in cur.fetchall()]
    assert all(QR_FORMAT.match(c) for c in codes)
    assert len(set(codes)) == len(codes)


def test_qr_code_never_changes():
    with as_service() as cur, pytest.raises(psycopg2.errors.CheckViolation):
        cur.execute("update products set qr_code = 'ABCDEFGH' where id = %s", (PRODUCT,))


def test_editing_a_product_keeps_its_qr_code():
    with as_service() as cur:
        cur.execute("select qr_code from products where id = %s", (PRODUCT,))
        before = cur.fetchone()[0]
        cur.execute("update products set name = 'Royal Sofa II', base_price = 45000"
                    " where id = %s returning qr_code", (PRODUCT,))
        assert cur.fetchone()[0] == before


def test_a_malformed_qr_code_is_refused():
    with as_service() as cur, pytest.raises(psycopg2.errors.CheckViolation):
        cur.execute("insert into products (name, qr_code) values ('X', 'ILLEGAL0')")


# ─── Pending 0054: the staff column lockdown ────────────────────────────────

@pytest.mark.parametrize("uid", [WM_UID, DRV_UID, "a0000000-0000-0000-0000-000000000002"])
def test_0054_no_staff_jwt_reads_price_columns_from_products(uid):
    with with_0054(uid) as cur, pytest.raises(psycopg2.errors.InsufficientPrivilege):
        cur.execute("select base_price from products")


def test_0054_the_view_still_serves_prices_to_sellers():
    with with_0054("a0000000-0000-0000-0000-000000000002") as cur:   # SP1
        cur.execute("select base_price from product_prices where product_id = %s", (PRODUCT,))
        assert cur.fetchone() == (42000,)


def test_0054_every_non_price_column_stays_readable():
    """A column added to products later is NOT browser-readable until 0054's successor
    grants it (safe default for a money table). This fails at that moment so the call is
    made deliberately rather than discovered as a broken page."""
    with as_service() as cur:
        cur.execute("select column_name from information_schema.columns"
                    " where table_schema = 'public' and table_name = 'products'")
        expected = {r[0] for r in cur.fetchall()} - PRICE_COLUMNS
    with with_0054(WM_UID) as cur:
        cur.execute(f"select {', '.join(sorted(expected))} from products where id = %s", (PRODUCT,))
        assert cur.fetchone() is not None


def test_0054_categories_view_still_works():
    with with_0054(WM_UID) as cur:
        cur.execute("select category from product_categories")
        assert ("Sofa",) in cur.fetchall()
