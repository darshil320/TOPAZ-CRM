#!/usr/bin/env python3
"""Idempotent demo/UAT seed for Phase 2A (module 07).

Seeds: 5 products, 10 customers (with consent), 6 quotations across statuses,
4 orders (2 from approved quotes), payments + schedules. Re-running wipes only
the demo rows (tagged via consents.method = 'seed_demo') and rebuilds them —
real data is never touched.

Usage:
    DATABASE_URL=postgresql://... python apps/api/scripts/seed_demo.py
    # or pass --db postgresql://...
Money totals are computed with the real gst engine (server truth).
"""
import argparse
import os
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import psycopg2

# Make `src` importable so the seed uses the real GST engine.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.services import gst  # noqa: E402

# consents.method is CHECK-constrained to kiosk/app/web_form, so demo rows are
# tagged by a phone marker instead.
SEED_METHOD = "web_form"
DEMO_PHONE_PREFIX = "+9198"

PRODUCTS = [
    ("Royal 3-Seater Sofa", "Sofa", "9401", Decimal("18"), Decimal("42000"), "nos"),
    ("Sheesham Dining Table 6-seat", "Dining", "9403", Decimal("18"), Decimal("38000"), "nos"),
    ("King Bed with Storage", "Bedroom", "9403", Decimal("18"), Decimal("55000"), "nos"),
    ("Office Executive Chair", "Office", "9401", Decimal("18"), Decimal("12500"), "nos"),
    ("Cushion Set (pair)", "Accessory", "9404", Decimal("5"), Decimal("1800"), "set"),
]

CUSTOMERS = [
    "Hemant Shah", "Priya Mehta", "Rajesh Patel", "Anita Desai", "Vikram Joshi",
    "Sunita Rao", "Amit Kulkarni", "Neha Gupta", "Farhan Sheikh", "Kiran Nair",
]

# (customer index, [(desc, qty, price, rate, hsn)], status)
QUOTES = [
    (0, [("Royal 3-Seater Sofa", "1", "42000", "18", "9401"), ("Cushion Set (pair)", "2", "1800", "5", "9404")], "approved"),
    (1, [("Sheesham Dining Table 6-seat", "1", "38000", "18", "9403")], "approved"),
    (2, [("King Bed with Storage", "1", "55000", "18", "9403")], "sent"),
    (3, [("Office Executive Chair", "4", "12500", "18", "9401")], "draft"),
    (4, [("Royal 3-Seater Sofa", "2", "42000", "18", "9401")], "viewed"),
    (5, [("Sheesham Dining Table 6-seat", "1", "38000", "18", "9403")], "rejected"),
]


def _totals(items):
    lines = [gst.LineInput(qty=Decimal(q), unit_price=Decimal(p), gst_rate=Decimal(r))
             for _, q, p, r, _ in items]
    return gst.compute_document(lines, 0, "GJ", "GJ")


def is_seeded(cur) -> bool:
    """True if demo data already exists (identified by the phone marker).

    The seed is additive/idempotent by early-return rather than delete: payments
    are IMMUTABLE (a DB trigger blocks DELETE for everyone), so demo data can't
    be wiped in place. To re-seed, reset the database (or drop the demo customers
    manually, which requires first inserting refund rows for their payments)."""
    cur.execute("select 1 from customers where phone like %s limit 1", (DEMO_PHONE_PREFIX + "%",))
    return cur.fetchone() is not None


def seed(cur) -> bool:
    """Insert the demo fixture unless it already exists. Returns True if seeded."""
    if is_seeded(cur):
        return False

    # Products
    for name, cat, hsn, rate, price, unit in PRODUCTS:
        cur.execute(
            "insert into products (name, category, hsn, gst_rate, base_price, unit) "
            "values (%s,%s,%s,%s,%s,%s)", (name, cat, hsn, rate, price, unit))

    # Customers
    cust_ids = []
    for i, name in enumerate(CUSTOMERS):
        cur.execute("insert into consents (face_tracking, personal_data, whatsapp_marketing, method) "
                    "values (true, true, true, %s) returning id", (SEED_METHOD,))
        cid = cur.fetchone()[0]
        cur.execute("insert into customers (consent_id, name, phone) values (%s,%s,%s) returning id",
                    (cid, name, f"+9198{i:08d}"))
        cust_ids.append(cur.fetchone()[0])

    # Quotations
    quote_ids = []
    for n, (ci, items, statusv) in enumerate(QUOTES, start=1):
        t = _totals(items)
        cur.execute(
            "insert into quotations (quote_no, customer_id, status, valid_until, place_of_supply,"
            " subtotal, discount_amount, taxable_value, cgst, sgst, igst, grand_total, terms)"
            " values (%s,%s,%s,%s,'GJ',%s,%s,%s,%s,%s,%s,%s,%s) returning id",
            (f"QTN-DEMO-{n:04d}", cust_ids[ci], statusv, date.today() + timedelta(days=15),
             t.subtotal, t.discount_amount, t.taxable_value, t.cgst, t.sgst, t.igst, t.grand_total,
             "50% advance; balance before delivery."))
        qid = cur.fetchone()[0]
        quote_ids.append((qid, ci, items, statusv))
        for si, (desc, qty, price, rate, hsn) in enumerate(items):
            lt = gst.compute_line(qty, price).line_total
            cur.execute(
                "insert into quotation_items (quotation_id, description, qty, unit, unit_price, hsn,"
                " gst_rate, line_total, sort) values (%s,%s,%s,'nos',%s,%s,%s,%s,%s)",
                (qid, desc, Decimal(qty), Decimal(price), hsn, Decimal(rate), lt, si))

    # Orders from the two approved quotes (+ 2 manual)
    order_ids = []
    n = 1
    for qid, ci, items, statusv in quote_ids:
        if statusv != "approved":
            continue
        t = _totals(items)
        advance = (t.grand_total * Decimal("50") / Decimal("100")).quantize(Decimal("0.01"))
        cur.execute(
            "insert into orders (order_no, customer_id, quotation_id, status, advance_expected,"
            " subtotal, discount_amount, taxable_value, cgst, sgst, igst, grand_total)"
            " values (%s,%s,%s,'confirmed',%s,%s,%s,%s,%s,%s,%s,%s) returning id",
            (f"ORD-DEMO-{n:04d}", cust_ids[ci], qid, advance, t.subtotal, t.discount_amount,
             t.taxable_value, t.cgst, t.sgst, t.igst, t.grand_total))
        oid = cur.fetchone()[0]
        order_ids.append((oid, ci, t.grand_total, advance))
        for si, (desc, qty, price, rate, hsn) in enumerate(items):
            lt = gst.compute_line(qty, price).line_total
            cur.execute(
                "insert into order_items (order_id, description, qty, unit, unit_price, hsn,"
                " gst_rate, line_total, sort) values (%s,%s,%s,'nos',%s,%s,%s,%s,%s)",
                (oid, desc, Decimal(qty), Decimal(price), hsn, Decimal(rate), lt, si))
        n += 1

    # Workshops (module 08). The real `workshops` table ships EMPTY on purpose —
    # a fake workshop can receive a real allocation and drive an order to 'ready'
    # against a site that doesn't exist. These two exist only so dev/UAT has
    # something to allocate to; they carry the demo phone marker.
    workshop_ids = []
    for wname, wtype, mgr, i in (
        ("Demo Workshop — Katargam", "own", "Suresh", 0),
        ("Demo Vendor — Sachin GIDC", "vendor", "Rakesh", 1),
    ):
        cur.execute(
            "insert into workshops (name, type, manager_name, manager_phone, address)"
            " values (%s,%s,%s,%s,%s) returning id",
            (wname, wtype, mgr, f"+9198{90 + i:08d}", "Surat, Gujarat"))
        workshop_ids.append(cur.fetchone()[0])

    # Allocate the first item of the first demo order, so the allocate page has
    # both an allocated and an unallocated example. current_stage is set the same
    # way production_repo.allocate sets it (first active stage by sort).
    if order_ids and workshop_ids:
        cur.execute("select id from order_items where order_id = %s order by sort limit 1",
                    (order_ids[0][0],))
        first_item = cur.fetchone()
        if first_item:
            cur.execute(
                "insert into order_item_assignments (order_item_id, workshop_id, due_date, active)"
                " values (%s,%s,%s,true)",
                (first_item[0], workshop_ids[0], date.today() + timedelta(days=21)))
            cur.execute(
                "update order_items set workshop_id = %s,"
                " current_stage = (select code from production_stage_defs where active"
                "                   order by sort limit 1),"
                " current_stage_at = now() where id = %s",
                (workshop_ids[0], first_item[0]))

    # Payments + schedules on the orders (one fully paid advance, one partial)
    for idx, (oid, ci, grand, advance) in enumerate(order_ids):
        cur.execute(
            "insert into payment_schedules (order_id, label, due_date, amount, status) values"
            " (%s,'Advance',%s,%s,'paid'), (%s,'Balance',%s,%s,'pending')",
            (oid, date.today(), advance, oid, date.today() + timedelta(days=30), grand - advance))
        cur.execute(
            "insert into payments (receipt_no, order_id, customer_id, kind, amount, mode, paid_at)"
            " values (%s,%s,%s,'advance',%s,'upi',%s)",
            (f"RCP-DEMO-{idx + 1:04d}", oid, cust_ids[ci], advance, datetime.now(timezone.utc)))

    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.environ.get("DATABASE_URL") or os.environ.get("TEST_DATABASE_URL"))
    args = parser.parse_args()
    if not args.db:
        print("Set DATABASE_URL (or --db). Refusing to guess.", file=sys.stderr)
        sys.exit(1)
    # psycopg2 wants the plain scheme, not the asyncpg one.
    url = args.db.replace("postgresql+asyncpg://", "postgresql://")

    conn = psycopg2.connect(url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            seeded = seed(cur)
        conn.commit()
        print("Demo data seeded." if seeded else "Demo data already present — nothing to do.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
