"""Empirical: allocate_number() is atomic + collision-free under concurrency.

Runs only when TEST_DATABASE_URL points at a migrated cluster (the pgtest harness
sets it). Proves the DB-level guarantee the numbering service relies on: no two
callers ever receive the same number, even racing in parallel.
"""
import os
import threading

import psycopg2
import pytest

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="needs TEST_DATABASE_URL (run via pgtest.sh)")


def _allocate(series, fy):
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("select allocate_number(%s, %s)", (series, fy))
            return cur.fetchone()[0]
    finally:
        conn.close()


def _reset(series, fy):
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("delete from doc_series where series=%s and fiscal_year=%s", (series, fy))
    finally:
        conn.close()


def test_serial_allocation_is_gapless_sequence():
    _reset("QTN", "9901")
    nums = [_allocate("QTN", "9901") for _ in range(10)]
    assert nums == list(range(1, 11))


def test_concurrent_allocation_no_duplicates():
    _reset("ORD", "9902")
    n = 40
    results = []
    lock = threading.Lock()
    barrier = threading.Barrier(n)

    def worker():
        barrier.wait()  # release all threads at once → maximal contention
        val = _allocate("ORD", "9902")
        with lock:
            results.append(val)

    threads = [threading.Thread(target=worker) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(results) == n
    assert len(set(results)) == n, f"duplicate numbers allocated: {sorted(results)}"
    assert sorted(results) == list(range(1, n + 1))


def test_series_and_fy_are_independent():
    _reset("QTN", "9903")
    _reset("RCP", "9903")
    assert _allocate("QTN", "9903") == 1
    assert _allocate("RCP", "9903") == 1  # different series, own counter
    assert _allocate("QTN", "9903") == 2
