"""Empirical DB gates for module 01 foundation.

Proves the behaviours the migrations promise: payments are immutable (UPDATE/DELETE
raise), order_outstanding computes paid/outstanding correctly (incl. refund
reversal), and a quotation + items round-trips. Service-role connection (superuser)
= the FastAPI/Celery trust boundary. Everything runs in one rolled-back transaction.
"""
import os

import psycopg2
import pytest

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


@pytest.fixture()
def conn():
    c = psycopg2.connect(DB_URL)
    c.autocommit = False
    try:
        yield c
    finally:
        c.rollback()
        c.close()


def _fixture_order(cur, grand_total="1000.00"):
    cur.execute("insert into consents (face_tracking, personal_data, whatsapp_marketing, method) "
                "values (true, true, true, 'kiosk') returning id")
    consent = cur.fetchone()[0]
    cur.execute("insert into customers (consent_id, name) values (%s, 'Test Cust') returning id", (consent,))
    cust = cur.fetchone()[0]
    cur.execute("insert into salespersons (name, whatsapp, role) values ('Owner','+910000009999','owner') returning id")
    sp = cur.fetchone()[0]
    cur.execute("insert into orders (order_no, customer_id, grand_total, salesperson_id) "
                "values ('ORD-TEST-0001', %s, %s, %s) returning id", (cust, grand_total, sp))
    order = cur.fetchone()[0]
    return cust, sp, order


def _pay(cur, order, cust, receipt, kind, amount):
    cur.execute("insert into payments (receipt_no, order_id, customer_id, kind, amount, mode, paid_at) "
                "values (%s, %s, %s, %s, %s, 'cash', now()) returning id",
                (receipt, order, cust, kind, amount))
    return cur.fetchone()[0]


def test_payment_update_is_blocked(conn):
    cur = conn.cursor()
    cust, sp, order = _fixture_order(cur)
    pay = _pay(cur, order, cust, "RCP-TEST-0001", "advance", "500.00")
    cur.execute("savepoint s")
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        cur.execute("update payments set amount = 1 where id = %s", (pay,))
    cur.execute("rollback to savepoint s")


def test_payment_delete_is_blocked(conn):
    cur = conn.cursor()
    cust, sp, order = _fixture_order(cur)
    pay = _pay(cur, order, cust, "RCP-TEST-0002", "advance", "500.00")
    cur.execute("savepoint s")
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        cur.execute("delete from payments where id = %s", (pay,))
    cur.execute("rollback to savepoint s")


def test_payment_amount_must_be_positive(conn):
    cur = conn.cursor()
    cust, sp, order = _fixture_order(cur)
    cur.execute("savepoint s")
    with pytest.raises(psycopg2.errors.CheckViolation):
        _pay(cur, order, cust, "RCP-TEST-0003", "advance", "0")
    cur.execute("rollback to savepoint s")


def test_order_outstanding_counts_payments_and_refunds(conn):
    cur = conn.cursor()
    cust, sp, order = _fixture_order(cur, grand_total="1000.00")
    _pay(cur, order, cust, "RCP-TEST-0010", "advance", "600.00")
    cur.execute("select paid, outstanding from order_outstanding where order_id = %s", (order,))
    paid, outstanding = cur.fetchone()
    assert (str(paid), str(outstanding)) == ("600.00", "400.00")

    # A refund reverses paid: paid 600 − 100 = 500, outstanding back to 500.
    _pay(cur, order, cust, "RCP-TEST-0011", "refund", "100.00")
    cur.execute("select paid, outstanding from order_outstanding where order_id = %s", (order,))
    paid, outstanding = cur.fetchone()
    assert (str(paid), str(outstanding)) == ("500.00", "500.00")


def test_order_outstanding_zero_when_unpaid(conn):
    cur = conn.cursor()
    cust, sp, order = _fixture_order(cur, grand_total="2500.00")
    cur.execute("select paid, outstanding from order_outstanding where order_id = %s", (order,))
    paid, outstanding = cur.fetchone()
    assert (str(paid), str(outstanding)) == ("0", "2500.00")


def test_quotation_with_items_roundtrips(conn):
    cur = conn.cursor()
    cust, sp, order = _fixture_order(cur)
    cur.execute(
        "insert into quotations (quote_no, customer_id, subtotal, taxable_value, cgst, sgst, grand_total, created_by) "
        "values ('QTN-TEST-0001', %s, 3000, 3000, 140, 140, 3280, %s) returning id, approval_token",
        (cust, sp),
    )
    quote, token = cur.fetchone()
    assert token is not None  # approval_token auto-generated
    for i, (desc, qty, price, rate, total) in enumerate([
        ("3-seater sofa", "1", "1000.00", "18.00", "1000.00"),
        ("Dining set", "1", "2000.00", "5.00", "2000.00"),
    ]):
        cur.execute(
            "insert into quotation_items (quotation_id, description, qty, unit_price, hsn, gst_rate, line_total, sort) "
            "values (%s, %s, %s, %s, '9403', %s, %s, %s)",
            (quote, desc, qty, price, rate, total, i),
        )
    cur.execute("select count(*), sum(line_total) from quotation_items where quotation_id = %s", (quote,))
    count, total = cur.fetchone()
    assert count == 2 and str(total) == "3000.00"


def test_is_role_callable_returns_boolean(conn):
    # Full role-behaviour is covered by the RLS suite (module 06). Here we only assert
    # the helper exists and is boolean-typed. auth.uid() is null (service) → false.
    cur = conn.cursor()
    cur.execute("select is_role(array['owner','admin'])")
    assert cur.fetchone()[0] is False
