"""Empirical: the demo seed runs clean against the real schema and is idempotent."""
import os

import psycopg2
import pytest

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def test_seed_is_idempotent_and_consistent():
    from scripts import seed_demo

    url = DB_URL.replace("postgresql+asyncpg://", "postgresql://")

    def run_once():
        conn = psycopg2.connect(url)
        conn.autocommit = False
        try:
            with conn.cursor() as cur:
                seeded = seed_demo.seed(cur)
            conn.commit()
            return seeded
        finally:
            conn.close()

    assert run_once() is True   # first run seeds
    assert run_once() is False  # second run is a no-op (payments are immutable)

    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute("select count(*) from customers where phone like '+9198%'")
            assert cur.fetchone()[0] == 10  # not 20 — idempotent
            cur.execute("select count(*) from quotations where quote_no like 'QTN-DEMO-%'")
            assert cur.fetchone()[0] == 6
            cur.execute("select count(*) from orders where order_no like 'ORD-DEMO-%'")
            assert cur.fetchone()[0] == 2  # from the 2 approved quotes
            cur.execute("select count(*) from payments where receipt_no like 'RCP-DEMO-%'")
            assert cur.fetchone()[0] == 2
            # order totals must equal the quote they came from (server truth)
            cur.execute(
                "select o.grand_total, q.grand_total from orders o"
                " join quotations q on q.id = o.quotation_id where o.order_no like 'ORD-DEMO-%'")
            for order_total, quote_total in cur.fetchall():
                assert order_total == quote_total
    finally:
        conn.close()
