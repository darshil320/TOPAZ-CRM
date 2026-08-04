"""Empirical DB gates for 0040 · a delivery carries items from MANY orders.

The scenario the client asked for: one lorry leaves with the Central Table from
ORD-1 and the Sofa from ORD-2. Before 0040 that was unrepresentable —
`deliveries.order_id` was a NOT NULL FK to a single order (0026) and
`schedule_delivery` raised `'Item % does not belong to this order'` (0039).

What these tests pin down, in the order it matters:

  1. One delivery, N orders, N customers — and `delivery_items` carries the
     mapping back to the originating order (requirement 3).
  2. A CONSIGNMENT is the paperwork grain: one per (delivery, customer), because a
     challan is one lorry's goods for one recipient, signed once. Two orders of the
     same customer therefore share ONE consignment; two customers get two.
  3. Authorization is per order. A salesperson may not smuggle another
     salesperson's customer's goods onto their run.
  4. Completion is per item and per order: only what the driver marked `received`
     is stamped, and each order advances on its own remaining-items count.
  5. `orders.fulfillment_status` + the `order_fulfillment` view tell the truth
     about Not / Partially / Fully delivered.

Runs on the temp cluster via `apps/api/scripts/pgtest.sh` — the same harness and
persona impersonation as tests/test_rls_phase2a.py.
"""
import json
import os

import psycopg2
import pytest

from tests.rls_support import (
    CUST1,
    CUST2,
    DB_URL,
    as_owner,
    as_role,
    as_service,
    as_sp1,
    as_sp2,
    seed_db,
)

# Same guard as the other *_empirical suites: without a cluster these are skipped, not
# failed, so `pytest tests/` stays green on a machine with no Postgres.
pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="needs TEST_DATABASE_URL (run via pgtest.sh)",
)

# ─── Fixture ids ──────────────────────────────────────────────────────────────
# CUST1 is assigned to SP1 (rls_support); CUST2 is unclaimed, so SP1 must be
# refused on its goods while the owner is not.
DRIVER_ID = "10000000-0000-0000-0000-0000000000d1"
DRIVER_UID = "a0000000-0000-0000-0000-0000000000d1"

ORD1 = "60000000-0000-0000-0000-0000000000a1"  # CUST1 — Central Table + Bed
ORD2 = "60000000-0000-0000-0000-0000000000a2"  # CUST2 — Sofa + Coffee Table
ORD3 = "60000000-0000-0000-0000-0000000000a3"  # CUST1 again — TV Unit

ITEM_TABLE = "70000000-0000-0000-0000-0000000000a1"  # ORD1
ITEM_BED = "70000000-0000-0000-0000-0000000000a2"  # ORD1
ITEM_SOFA = "70000000-0000-0000-0000-0000000000a3"  # ORD2
ITEM_COFFEE = "70000000-0000-0000-0000-0000000000a4"  # ORD2
ITEM_TV = "70000000-0000-0000-0000-0000000000a5"  # ORD3

_ORDERS = (
    (ORD1, "ORD-MOD-0001", CUST1),
    (ORD2, "ORD-MOD-0002", CUST2),
    (ORD3, "ORD-MOD-0003", CUST1),
)
_ITEMS = (
    (ITEM_TABLE, ORD1, "Central Table"),
    (ITEM_BED, ORD1, "Bed"),
    (ITEM_SOFA, ORD2, "Sofa"),
    (ITEM_COFFEE, ORD2, "Coffee Table"),
    (ITEM_TV, ORD3, "TV Unit"),
)


def _seed():
    """Three orders across two customers, every line production-complete.

    `seed_db()` truncates `salespersons`, which cascades to orders/order_items/
    deliveries — so this only has to insert.
    """
    seed_db()
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "insert into salespersons (id, auth_uid, name, whatsapp, role) "
            "values (%s, %s, 'Dilip', '+910000000021', 'delivery')",
            (DRIVER_ID, DRIVER_UID),
        )
        for order_id, order_no, customer in _ORDERS:
            cur.execute(
                "insert into orders (id, order_no, customer_id, status, grand_total) "
                "values (%s, %s, %s, 'ready', 1000)",
                (order_id, order_no, customer),
            )
        for item_id, order_id, description in _ITEMS:
            cur.execute(
                "insert into order_items (id, order_id, description, qty, unit, unit_price,"
                " hsn, gst_rate, line_total, production_done_at)"
                " values (%s, %s, %s, 1, 'nos', 1000, '9403', 18, 1000, now())",
                (item_id, order_id, description),
            )
    conn.close()


def _schedule(cur, items, consignments=None, driver=DRIVER_ID, date="2026-08-10"):
    """Call the RPC the dashboard calls. ONE jsonb argument on purpose — see 0040."""
    payload = {
        "scheduled_date": date,
        "driver_salesperson_id": driver,
        "items": list(items),
    }
    if consignments is not None:
        payload["consignments"] = consignments
    cur.execute("select schedule_delivery(%s::jsonb)", (json.dumps(payload),))
    return cur.fetchone()[0]


def as_role_driver():
    """The `delivery`-role persona — the driver whose run it is."""
    return as_role("authenticated", DRIVER_UID)


def _one(cur, sql, params=()):
    cur.execute(sql, params)
    row = cur.fetchone()
    return row[0] if row else None


# ─── 1 · one delivery, many orders ────────────────────────────────────────────


def test_one_delivery_spans_two_orders_of_two_customers():
    _seed()
    with as_owner() as cur:
        delivery = _schedule(cur, [ITEM_TABLE, ITEM_SOFA])
        assert delivery is not None

        cur.execute(
            "select oi.description, di.order_id, di.customer_id"
            "  from delivery_items di join order_items oi on oi.id = di.order_item_id"
            " where di.delivery_id = %s order by oi.description",
            (delivery,),
        )
        rows = cur.fetchall()
        assert [r[0] for r in rows] == ["Central Table", "Sofa"]
        assert {str(r[1]) for r in rows} == {ORD1, ORD2}
        assert {str(r[2]) for r in rows} == {CUST1, CUST2}


def test_mixed_run_leaves_the_undelivered_items_alone():
    """The Bed and the Coffee Table stay schedulable for a future run."""
    _seed()
    with as_owner() as cur:
        _schedule(cur, [ITEM_TABLE, ITEM_SOFA])
        cur.execute(
            "select count(*) from order_items"
            " where id in %s and delivered_at is null",
            ((ITEM_BED, ITEM_COFFEE),),
        )
        assert cur.fetchone()[0] == 2


# ─── 2 · consignment = (delivery, customer) ───────────────────────────────────


def test_two_customers_get_two_consignments():
    _seed()
    with as_owner() as cur:
        delivery = _schedule(cur, [ITEM_TABLE, ITEM_SOFA])
        cur.execute(
            "select customer_id from delivery_consignments where delivery_id = %s",
            (delivery,),
        )
        assert {str(r[0]) for r in cur.fetchall()} == {CUST1, CUST2}


def test_two_orders_of_one_customer_share_one_consignment():
    """One recipient signs ONE challan, even when the goods span two of their orders."""
    _seed()
    with as_owner() as cur:
        delivery = _schedule(cur, [ITEM_TABLE, ITEM_TV])  # ORD1 + ORD3, both CUST1
        assert _one(
            cur,
            "select count(*) from delivery_consignments where delivery_id = %s",
            (delivery,),
        ) == 1
        assert _one(
            cur,
            "select count(distinct consignment_id) from delivery_items where delivery_id = %s",
            (delivery,),
        ) == 1


def test_consignment_paperwork_is_stored_per_customer():
    _seed()
    with as_owner() as cur:
        delivery = _schedule(
            cur,
            [ITEM_TABLE, ITEM_SOFA],
            consignments=[
                {"customer_id": CUST1, "delivery_address": "Vesu site", "delivery_rent": 500,
                 "dp_code": "ASG"},
                {"customer_id": CUST2, "delivery_address": "Adajan flat"},
            ],
        )
        cur.execute(
            "select customer_id, delivery_address, delivery_rent, dp_code"
            "  from delivery_consignments where delivery_id = %s order by delivery_address",
            (delivery,),
        )
        rows = cur.fetchall()
        assert [(r[1], r[3]) for r in rows] == [("Adajan flat", None), ("Vesu site", "ASG")]
        assert str(rows[1][2]) == "500.00"


def test_consignment_for_a_customer_with_no_goods_is_refused():
    """Paperwork cannot be invented for a recipient nothing is going to."""
    _seed()
    with as_owner() as cur:
        with pytest.raises(psycopg2.errors.RaiseException):
            _schedule(
                cur,
                [ITEM_TABLE],
                consignments=[{"customer_id": CUST2, "delivery_address": "Nowhere"}],
            )


def test_challan_no_is_unique_across_consignments():
    _seed()
    with as_service() as cur:
        delivery = _schedule(cur, [ITEM_TABLE, ITEM_SOFA])
        cur.execute(
            "update delivery_consignments set challan_no = 'T.F 66'"
            " where delivery_id = %s and customer_id = %s",
            (delivery, CUST1),
        )
        cur.execute("savepoint s")
        with pytest.raises(psycopg2.errors.UniqueViolation):
            cur.execute(
                "update delivery_consignments set challan_no = 'T.F 66'"
                " where delivery_id = %s and customer_id = %s",
                (delivery, CUST2),
            )
        cur.execute("rollback to savepoint s")


# ─── 3 · authorization is per order ───────────────────────────────────────────


def test_salesperson_cannot_put_another_customers_item_on_their_run():
    _seed()
    with as_sp1() as cur:  # SP1 is assigned to CUST1 only
        with pytest.raises(psycopg2.errors.RaiseException):
            _schedule(cur, [ITEM_TABLE, ITEM_SOFA])


def test_salesperson_can_schedule_their_own_customers_items():
    _seed()
    with as_sp1() as cur:
        delivery = _schedule(cur, [ITEM_TABLE, ITEM_TV])
        assert delivery is not None


def test_unrelated_salesperson_is_refused_outright():
    _seed()
    with as_sp2() as cur:  # assigned to nobody
        with pytest.raises(psycopg2.errors.RaiseException):
            _schedule(cur, [ITEM_TABLE])


def test_empty_item_list_is_refused():
    """An empty selection is an ambiguous instruction, not 'the whole order' (0039)."""
    _seed()
    with as_owner() as cur:
        with pytest.raises(psycopg2.errors.RaiseException):
            _schedule(cur, [])


def test_unknown_item_is_refused():
    _seed()
    with as_owner() as cur:
        with pytest.raises(psycopg2.errors.RaiseException):
            _schedule(cur, ["70000000-0000-0000-0000-00000000ffff"])


def test_item_already_on_an_open_run_is_refused():
    """delivery_items_one_open (0039) is untouched by 0040 — whole lines only."""
    _seed()
    with as_owner() as cur:
        _schedule(cur, [ITEM_TABLE, ITEM_SOFA])
        cur.execute("savepoint s")
        with pytest.raises(psycopg2.errors.UniqueViolation):
            _schedule(cur, [ITEM_TABLE], date="2026-08-11")
        cur.execute("rollback to savepoint s")


# ─── 4 · completion, per item and per order ───────────────────────────────────


def _deliver(cur, delivery):
    cur.execute(
        "update deliveries set status = 'delivered', delivered_at = now() where id = %s",
        (delivery,),
    )


def test_completion_stamps_only_the_items_the_driver_received():
    _seed()
    with as_service() as cur:
        delivery = _schedule(cur, [ITEM_TABLE, ITEM_BED])
        cur.execute(
            "update delivery_items set received = false"
            " where delivery_id = %s and order_item_id = %s",
            (delivery, ITEM_BED),
        )
        _deliver(cur, delivery)

        assert _one(cur, "select delivered_at is not null from order_items where id = %s",
                    (ITEM_TABLE,)) is True
        assert _one(cur, "select delivered_at is null from order_items where id = %s",
                    (ITEM_BED,)) is True


def test_received_defaults_true_so_pre_0040_behaviour_is_preserved():
    """The driver PWA does not write `received` until its own deploy. Until then a
    completed run must still stamp its goods, exactly as 0039 did."""
    _seed()
    with as_service() as cur:
        delivery = _schedule(cur, [ITEM_TABLE, ITEM_BED])
        _deliver(cur, delivery)
        assert _one(
            cur,
            "select count(*) from order_items where id in %s and delivered_at is not null",
            ((ITEM_TABLE, ITEM_BED),),
        ) == 2


def test_each_order_advances_on_its_own_remaining_count():
    """ORD1 goes out completely and becomes 'delivered'; ORD2 is part-shipped and
    stays 'ready' so the rest of it can still be scheduled."""
    _seed()
    with as_service() as cur:
        delivery = _schedule(cur, [ITEM_TABLE, ITEM_BED, ITEM_SOFA])
        _deliver(cur, delivery)
        assert _one(cur, "select status from orders where id = %s", (ORD1,)) == "delivered"
        assert _one(cur, "select status from orders where id = %s", (ORD2,)) == "ready"


def test_completion_audits_every_order_on_the_run():
    _seed()
    with as_service() as cur:
        delivery = _schedule(cur, [ITEM_TABLE, ITEM_SOFA])
        _deliver(cur, delivery)
        cur.execute(
            "select entity_id from audit_log"
            " where entity = 'orders' and action = 'delivered'"
            "   and payload->>'delivery_id' = %s",
            (str(delivery),),
        )
        assert {str(r[0]) for r in cur.fetchall()} == {ORD1, ORD2}


def test_a_failed_run_stamps_nothing():
    _seed()
    with as_service() as cur:
        delivery = _schedule(cur, [ITEM_TABLE])
        cur.execute("update deliveries set status = 'failed' where id = %s", (delivery,))
        assert _one(cur, "select delivered_at is null from order_items where id = %s",
                    (ITEM_TABLE,)) is True


# ─── 5 · fulfilment truth ─────────────────────────────────────────────────────


def test_fulfillment_status_walks_not_partial_full():
    _seed()
    with as_service() as cur:
        assert _one(cur, "select fulfillment_status from orders where id = %s",
                    (ORD1,)) == "not_delivered"

        first = _schedule(cur, [ITEM_TABLE])
        _deliver(cur, first)
        assert _one(cur, "select fulfillment_status from orders where id = %s",
                    (ORD1,)) == "partially_delivered"

        second = _schedule(cur, [ITEM_BED], date="2026-08-20")
        _deliver(cur, second)
        assert _one(cur, "select fulfillment_status from orders where id = %s",
                    (ORD1,)) == "fully_delivered"


def test_order_fulfillment_view_agrees_with_the_column():
    _seed()
    with as_service() as cur:
        _deliver(cur, _schedule(cur, [ITEM_SOFA]))
        cur.execute(
            "select o.fulfillment_status, f.fulfillment, f.item_count, f.delivered_count"
            "  from orders o join order_fulfillment f on f.order_id = o.id"
            " where o.id = %s",
            (ORD2,),
        )
        column, view, total, done = cur.fetchone()
        assert column == view == "partially_delivered"
        assert (total, done) == (2, 1)


def test_a_terminal_order_status_wins_over_missing_item_stamps():
    """An order marked installed by hand has NO stamped items — that is the pre-per-item
    history, and it is still the path when somebody corrects the record. Reading it as
    "Not delivered" while its own status says the furniture is in the customer's house is a
    visibly wrong answer on the orders list."""
    _seed()
    with as_service() as cur:
        for status in ("delivered", "installed", "closed"):
            cur.execute("savepoint s")
            cur.execute("update orders set status = %s where id = %s", (status, ORD1))
            assert _one(cur, "select fulfillment_status from orders where id = %s",
                        (ORD1,)) == "fully_delivered", status
            assert _one(cur, "select fulfillment from order_fulfillment where order_id = %s",
                        (ORD1,)) == "fully_delivered", status
            cur.execute("rollback to savepoint s")


def test_a_cancelled_order_is_not_fully_delivered():
    """'cancelled' is deliberately not a terminal DELIVERED state — its goods went nowhere."""
    _seed()
    with as_service() as cur:
        cur.execute("update orders set status = 'cancelled' where id = %s", (ORD1,))
        assert _one(cur, "select fulfillment_status from orders where id = %s",
                    (ORD1,)) == "not_delivered"


def test_a_status_change_alone_updates_the_column():
    """The rule takes orders.status as an input, so a status change must recompute it —
    otherwise the column silently lags the record it is derived from."""
    _seed()
    with as_service() as cur:
        assert _one(cur, "select fulfillment_status from orders where id = %s",
                    (ORD2,)) == "not_delivered"
        cur.execute("update orders set status = 'installed' where id = %s", (ORD2,))
        assert _one(cur, "select fulfillment_status from orders where id = %s",
                    (ORD2,)) == "fully_delivered"


def test_the_rule_is_one_shared_function():
    """The trigger and the view must not be able to drift. Pure — no rows involved."""
    _seed()
    with as_service() as cur:
        cases = [
            ("ready", 3, 0, "not_delivered"),
            ("ready", 3, 1, "partially_delivered"),
            ("ready", 3, 3, "fully_delivered"),
            ("confirmed", 0, 0, "not_delivered"),
            ("installed", 3, 0, "fully_delivered"),
            ("cancelled", 3, 0, "not_delivered"),
        ]
        for status, total, done, expected in cases:
            cur.execute("select compute_order_fulfillment(%s, %s, %s)", (status, total, done))
            assert cur.fetchone()[0] == expected, (status, total, done)


def test_an_order_with_no_items_is_not_delivered():
    """count(delivered_at) = count(id) = 0 must not read as 'fully delivered'."""
    _seed()
    with as_service() as cur:
        cur.execute(
            "insert into orders (order_no, customer_id, status, grand_total)"
            " values ('ORD-MOD-EMPTY', %s, 'confirmed', 0) returning id",
            (CUST1,),
        )
        empty = cur.fetchone()[0]
        assert _one(cur, "select fulfillment_status from orders where id = %s",
                    (empty,)) == "not_delivered"
        assert _one(cur, "select fulfillment from order_fulfillment where order_id = %s",
                    (empty,)) == "not_delivered"


# ─── 6 · the denorm is the database's, not the client's ───────────────────────


def test_delivery_item_order_and_customer_are_trigger_maintained():
    """A client-supplied order_id/customer_id is overwritten from `order_items`, so the
    mapping in requirement 3 cannot be forged or drift."""
    _seed()
    with as_service() as cur:
        delivery = _schedule(cur, [ITEM_TABLE])
        cur.execute(
            "insert into delivery_items (delivery_id, order_item_id, order_id, customer_id)"
            " values (%s, %s, %s, %s)",
            (delivery, ITEM_SOFA, ORD1, CUST1),  # both deliberately wrong
        )
        cur.execute(
            "select order_id, customer_id from delivery_items"
            " where delivery_id = %s and order_item_id = %s",
            (delivery, ITEM_SOFA),
        )
        order_id, customer_id = cur.fetchone()
        assert (str(order_id), str(customer_id)) == (ORD2, CUST2)


def test_deprecated_order_id_is_derived_not_null():
    """0040 keeps `deliveries.order_id` populated so every pre-0040 reader still works
    until 0042 drops it. It is one of the run's real orders, never a guess."""
    _seed()
    with as_owner() as cur:
        delivery = _schedule(cur, [ITEM_SOFA, ITEM_TABLE])
        assert _one(cur, "select order_id::text from deliveries where id = %s",
                    (delivery,)) in (ORD1, ORD2)


# ─── 7 · the driver's tick is a scoped write ──────────────────────────────────


def _committed_open_delivery(items=(ITEM_TABLE,)):
    """A scheduled run, COMMITTED, so persona connections can see it.

    Needed because `as_role` always rolls back: a policy test on an existing row has
    to read a row somebody else already committed. The next test's `_seed()` truncates
    it away, so nothing leaks between tests.
    """
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        delivery = _schedule(cur, list(items))
        cur.execute(
            "select id from delivery_items where delivery_id = %s order by order_item_id",
            (delivery,),
        )
        rows = [r[0] for r in cur.fetchall()]
    conn.close()
    return delivery, rows


def test_assigned_driver_may_mark_items_received():
    _seed()
    _delivery, [line] = _committed_open_delivery()
    with as_role_driver() as cur:
        cur.execute("update delivery_items set received = false where id = %s", (line,))
        assert cur.rowcount == 1


def test_assigned_salesperson_may_mark_items_received():
    _seed()
    _delivery, [line] = _committed_open_delivery()
    with as_sp1() as cur:  # ITEM_TABLE belongs to CUST1, assigned to SP1
        cur.execute("update delivery_items set received = false where id = %s", (line,))
        assert cur.rowcount == 1


def test_unrelated_salesperson_cannot_flip_received():
    _seed()
    _delivery, [line] = _committed_open_delivery()
    with as_sp2() as cur:
        cur.execute("update delivery_items set received = false where id = %s", (line,))
        # RLS filtered the UPDATE out: no row touched, no error. Exactly the failure the
        # driver PWA's completeDeliveryAction has to detect and report.
        assert cur.rowcount == 0


def test_a_client_cannot_rewrite_which_item_is_on_the_run():
    """Only `received` is writable — the column-level grant is the boundary. Repointing
    order_item_id would move goods between runs without any audit."""
    _seed()
    _delivery, [line] = _committed_open_delivery()
    with as_owner() as cur:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute(
                "update delivery_items set order_item_id = %s where id = %s",
                (ITEM_SOFA, line),
            )
