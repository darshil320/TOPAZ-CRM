"""Migration 0044 — proof that hoisting the RLS helpers into InitPlans changed
NOTHING about who can see what, and that it actually hoisted.

0044 is a planner-shape change on an authorization boundary, so "the existing RLS
suite still passes" is necessary but not sufficient: those tests probe a handful of
chosen rows. This file does two things they cannot.

1. **Differential equivalence.** For every persona and every rewritten table it
   evaluates the OLD predicate and the NEW predicate over EVERY row and asserts the
   two id sets are identical. Both run on a superuser connection (RLS bypassed) with
   `request.jwt.claims` set, so the helper functions resolve to that persona exactly
   as they do under a policy — this compares the EXPRESSIONS, independently of the
   RLS plumbing the other suites cover.

   Semantics, not shape, is the thing being protected. A rewrite that is 100x faster
   and shows one extra customer to one salesperson is a data breach, not an
   optimisation.

2. **The hoist is real.** `EXPLAIN (ANALYZE)` on a policy-filtered read must show the
   helper as a one-shot InitPlan, and the per-row `is_owner()` /
   `is_assigned_to_customer()` calls must be gone from the filter. Without this the
   migration is pure risk for no gain — and the failure mode is silent.

Runs only against a migrated DB (pgtest.sh); skipped otherwise.
"""
import json
import os

import psycopg2
import pytest

from tests.rls_support import (
    CUST1,
    CUST2,
    DB_URL,
    OWNER_UID,
    SP1_ID,
    SP1_UID,
    SP2_UID,
    seed_db,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="needs TEST_DATABASE_URL (run via pgtest.sh)",
)

ACC_UID = "a0000000-0000-0000-0000-0000000000a1"
WM_UID = "a0000000-0000-0000-0000-0000000000b1"
UNLINKED_UID = "a0000000-0000-0000-0000-0000000000c1"  # a JWT with no salesperson row

QUOTE1 = "50000000-0000-0000-0000-000000000001"
QUOTE2 = "50000000-0000-0000-0000-000000000002"
ORDER1 = "60000000-0000-0000-0000-000000000001"
ORDER2 = "60000000-0000-0000-0000-000000000002"


def _seed():
    """Both customers carry a quote, an order, items, a payment and a schedule, so
    every rewritten predicate has a visible row AND a hidden row to disagree about."""
    seed_db()
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("insert into salespersons (id, auth_uid, name, whatsapp, role) values"
                    " ('10000000-0000-0000-0000-0000000000a1',%s,'Anita','+910000000009','accounts')",
                    (ACC_UID,))
        cur.execute("insert into salespersons (id, auth_uid, name, whatsapp, role) values"
                    " ('10000000-0000-0000-0000-0000000000b1',%s,'Wasim','+910000000010','workshop_manager')",
                    (WM_UID,))
        # A collaborator assignment as well as the primary one — `my_assigned_customer_ids`
        # must return BOTH kinds, exactly as is_assigned_to_customer() accepts both.
        cur.execute("insert into customer_assignments (customer_id, salesperson_id, role, active)"
                    " values (%s,%s,'collaborator',true)", (CUST2, SP1_ID))
        # ...then retire it. An INACTIVE row must be invisible to both predicates —
        # this is the case a careless rewrite gets wrong.
        cur.execute("update customer_assignments set active = false"
                    " where customer_id = %s and salesperson_id = %s", (CUST2, SP1_ID))

        for qid, cid, no in ((QUOTE1, CUST1, "QTN-EQ-1"), (QUOTE2, CUST2, "QTN-EQ-2")):
            cur.execute("insert into quotations (id, quote_no, customer_id, status, grand_total)"
                        " values (%s,%s,%s,'approved',1000)", (qid, no, cid))
            cur.execute("insert into quotation_items (quotation_id, description, qty, unit_price,"
                        " hsn, gst_rate, line_total) values (%s,'Sofa',1,1000,'9401',18,1000)", (qid,))
        for oid, cid, no in ((ORDER1, CUST1, "ORD-EQ-1"), (ORDER2, CUST2, "ORD-EQ-2")):
            cur.execute("insert into orders (id, order_no, customer_id, status, grand_total)"
                        " values (%s,%s,%s,'confirmed',1000)", (oid, no, cid))
            cur.execute("insert into order_items (order_id, description, qty, unit_price,"
                        " hsn, gst_rate, line_total) values (%s,'Sofa',1,1000,'9401',18,1000)", (oid,))
            cur.execute("insert into payments (receipt_no, order_id, customer_id, kind, amount,"
                        " mode, paid_at) values (%s,%s,%s,'advance',500,'cash',now())",
                        (f"RCP-EQ-{no}", oid, cid))
            cur.execute("insert into payment_schedules (order_id, label, due_date, amount)"
                        " values (%s,'Balance', current_date + 7, 500)", (oid,))
        cur.execute("insert into pipeline_stages (customer_id, stage) values (%s,'new')", (CUST1,))
        cur.execute("insert into pipeline_stages (customer_id, stage) values (%s,'new')", (CUST2,))
        cur.execute("insert into alerts (customer_id, type, detail)"
                    " values (%s,'intent_call','x')", (CUST1,))
        cur.execute("insert into alerts (customer_id, type, detail)"
                    " values (%s,'intent_call','y')", (CUST2,))
        # An ANONYMOUS visit (customer_id NULL). `visits_select`'s
        # `customer_id is not null` guard is the one place a NULL reaches these
        # predicates, and NULL is exactly where `is_assigned_to_customer(NULL)` (false)
        # and `NULL in (...)` (null) could have diverged — so it must be in the fixture.
        cur.execute("insert into visits (match_band, raw_event_id)"
                    " values ('UNCERTAIN', gen_random_uuid())")
        cur.execute("insert into followups (customer_id, template_name, scheduled_at)"
                    " values (%s,'topaz_followup', now())", (CUST1,))
        cur.execute("insert into followups (customer_id, template_name, scheduled_at)"
                    " values (%s,'topaz_followup', now())", (CUST2,))
    conn.close()


ASSIGNED = "is_assigned_to_customer"
HOISTED = "in (select my_assigned_customer_ids())"

# (label, table, key column, OLD predicate, NEW predicate).
# The OLD strings are copied from the pre-0044 policy text; the NEW ones from 0044.
CASES = [
    ("cust_select", "customers", "id",
     "is_owner() or is_assigned_to_customer(id)",
     f"(select is_owner()) or id {HOISTED}"),
    ("visits_select", "visits", "id",
     "is_owner() or (customer_id is not null and is_assigned_to_customer(customer_id))",
     f"(select is_owner()) or (customer_id is not null and customer_id {HOISTED})"),
    ("ca_select", "customer_assignments", "id",
     "is_owner() or salesperson_id = current_salesperson_id()"
     " or is_assigned_to_customer(customer_id)",
     f"(select is_owner()) or salesperson_id = (select current_salesperson_id())"
     f" or customer_id {HOISTED}"),
    ("pipe_select", "pipeline_stages", "customer_id",
     "is_owner() or is_assigned_to_customer(customer_id)",
     f"(select is_owner()) or customer_id {HOISTED}"),
    ("msg_select", "messages", "id",
     "is_owner() or is_assigned_to_customer(customer_id)",
     f"(select is_owner()) or customer_id {HOISTED}"),
    ("fu_select", "followups", "id",
     "is_owner() or is_assigned_to_customer(customer_id)",
     f"(select is_owner()) or customer_id {HOISTED}"),
    ("alerts_select", "alerts", "id",
     "is_owner() or (customer_id is not null and is_assigned_to_customer(customer_id))",
     f"(select is_owner()) or (customer_id is not null and customer_id {HOISTED})"),
    ("q_select", "quotations", "id",
     "is_owner() or is_role(array['admin','accounts']) or is_assigned_to_customer(customer_id)",
     f"(select is_owner()) or (select is_role(array['admin','accounts']))"
     f" or customer_id {HOISTED}"),
    ("q_update", "quotations", "id",
     "is_owner() or is_role(array['admin']) or is_assigned_to_customer(customer_id)",
     f"(select is_owner()) or (select is_role(array['admin'])) or customer_id {HOISTED}"),
    ("o_select", "orders", "id",
     "is_owner() or is_role(array['admin','accounts']) or is_assigned_to_customer(customer_id)",
     f"(select is_owner()) or (select is_role(array['admin','accounts']))"
     f" or customer_id {HOISTED}"),
    ("o_delete", "orders", "id",
     "is_owner() or is_role(array['admin'])",
     "(select is_owner()) or (select is_role(array['admin']))"),
    ("pay_select", "payments", "id",
     "is_owner() or is_role(array['admin','accounts']) or is_assigned_to_customer(customer_id)",
     f"(select is_owner()) or (select is_role(array['admin','accounts']))"
     f" or customer_id {HOISTED}"),
    ("qi_select", "quotation_items", "id",
     "exists (select 1 from quotations q where q.id = quotation_id"
     " and (is_owner() or is_role(array['admin','accounts'])"
     "      or is_assigned_to_customer(q.customer_id)))",
     "exists (select 1 from quotations q where q.id = quotation_id"
     " and ((select is_owner()) or (select is_role(array['admin','accounts']))"
     f"      or q.customer_id {HOISTED}))"),
    ("oi_select", "order_items", "id",
     "exists (select 1 from orders o where o.id = order_id"
     " and (is_owner() or is_role(array['admin','accounts'])"
     "      or is_assigned_to_customer(o.customer_id)))",
     "exists (select 1 from orders o where o.id = order_id"
     " and ((select is_owner()) or (select is_role(array['admin','accounts']))"
     f"      or o.customer_id {HOISTED}))"),
    ("sched_select", "payment_schedules", "id",
     "is_owner() or is_role(array['admin','accounts'])"
     " or exists (select 1 from orders o where o.id = order_id"
     "            and is_assigned_to_customer(o.customer_id))",
     "(select is_owner()) or (select is_role(array['admin','accounts']))"
     " or exists (select 1 from orders o where o.id = order_id"
     f"            and o.customer_id {HOISTED})"),
    ("consent_select", "consents", "id",
     "is_owner() or exists (select 1 from customers c"
     " where c.consent_id = consents.id and is_assigned_to_customer(c.id))",
     "(select is_owner()) or exists (select 1 from customers c"
     f" where c.consent_id = consents.id and c.id {HOISTED})"),
]

# Every persona the rewritten predicates can resolve to, including the two that must
# see nothing: an unrelated salesperson and a JWT with no staff row at all.
PERSONAS = {
    "owner": OWNER_UID,
    "assigned_salesperson": SP1_UID,
    "unrelated_salesperson": SP2_UID,
    "accounts": ACC_UID,
    "workshop_manager": WM_UID,
    "unlinked_jwt": UNLINKED_UID,
    "anonymous_no_claims": None,
}


@pytest.fixture(scope="module")
def seeded_db():
    _seed()
    return DB_URL


def _visible(cur, table, key, predicate, auth_uid):
    """The ids a predicate admits, evaluated as `auth_uid`, with RLS bypassed.

    Superuser connection on purpose: this must compare the EXPRESSIONS over the whole
    table, which a policy-filtered read cannot do.
    """
    claims = {"role": "authenticated"}
    if auth_uid:
        claims["sub"] = auth_uid
    cur.execute("set local request.jwt.claims = %s", (json.dumps(claims),))
    # `predicate` is assembled from the literals in CASES above — never user input.
    cur.execute(f"select {key} from {table} where {predicate}")  # noqa: S608
    return sorted(str(r[0]) for r in cur.fetchall())


@pytest.mark.parametrize("case", CASES, ids=[c[0] for c in CASES])
@pytest.mark.parametrize("persona", list(PERSONAS), ids=list(PERSONAS))
def test_rewritten_predicate_admits_exactly_the_same_rows(seeded_db, case, persona):
    label, table, key, old, new = case
    uid = PERSONAS[persona]
    conn = psycopg2.connect(seeded_db)
    try:
        with conn.cursor() as cur:
            before = _visible(cur, table, key, old, uid)
        conn.rollback()
        with conn.cursor() as cur:
            after = _visible(cur, table, key, new, uid)
        conn.rollback()
    finally:
        conn.close()

    assert after == before, (
        f"0044 changed visibility for {label} as {persona}: "
        f"old={before} new={after}"
    )


def test_the_fixture_would_actually_catch_a_leak(seeded_db):
    """Guards the guard: if the seed produced no hidden rows, every equivalence
    assertion above would pass vacuously and prove nothing."""
    conn = psycopg2.connect(seeded_db)
    try:
        with conn.cursor() as cur:
            visible = _visible(cur, "orders", "id",
                               f"(select is_owner()) or customer_id {HOISTED}", SP1_UID)
            all_ids = _visible(cur, "orders", "id", "true", SP1_UID)
    finally:
        conn.close()
    assert len(visible) >= 1, "the assigned salesperson must see something"
    assert len(visible) < len(all_ids), "and must be blind to something"


def test_inactive_assignment_grants_nothing(seeded_db):
    """CUST2's assignment to SP1 was retired in the seed. Both predicates must agree
    that it grants no access — an `active` filter dropped from the rewrite would be
    invisible to a test that only ever looks at currently-assigned rows."""
    conn = psycopg2.connect(seeded_db)
    try:
        with conn.cursor() as cur:
            ids = _visible(cur, "customers", "id",
                           f"(select is_owner()) or id {HOISTED}", SP1_UID)
    finally:
        conn.close()
    assert CUST1 in ids
    assert CUST2 not in ids


def test_helper_is_evaluated_once_not_per_row(seeded_db):
    """The whole point of 0044: the plan must show the helper as a one-shot InitPlan,
    and the per-row calls must be gone from the table filter.

    Reads `orders` AS A SALESPERSON through the real policy, so this checks the
    shipped policy text rather than a predicate this test assembled.
    """
    conn = psycopg2.connect(seeded_db)
    try:
        cur = conn.cursor()
        cur.execute("set local role authenticated")
        cur.execute("set local request.jwt.claims = %s",
                    (json.dumps({"role": "authenticated", "sub": SP1_UID}),))
        cur.execute("explain (analyze, verbose) select id from orders order by created_at desc")
        plan = "\n".join(r[0] for r in cur.fetchall())
    finally:
        conn.rollback()
        conn.close()

    assert "InitPlan" in plan, f"helpers were not hoisted — plan was:\n{plan}"
    # The hoisted calls appear inside the InitPlan lines; what must NOT appear is a
    # per-row call left behind in the relation's own Filter.
    filter_lines = [ln for ln in plan.splitlines() if "Filter:" in ln]
    assert filter_lines, f"expected a policy filter on the scan — plan was:\n{plan}"
    leftover = [ln for ln in filter_lines if ASSIGNED in ln or "is_owner()" in ln]
    assert not leftover, (
        "a policy helper is still being called per row:\n" + "\n".join(leftover)
    )
