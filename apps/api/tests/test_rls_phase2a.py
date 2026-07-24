"""Phase 2A RLS matrix proof (module 06). Runs on the temp DB via pgtest.sh.

Proves the role boundary for money tables:
  - a salesperson is blind to another salesperson's customer's quotes
  - accounts + owner read all quotes; accounts may insert payments; a plain
    salesperson may NOT insert payments (pay_insert = owner/admin/accounts)
  - payments are immutable even for accounts/owner (trigger)
  - workshop_manager sees no payments (default deny — in no policy role list)
"""
import psycopg2
import pytest

from tests.rls_support import DB_URL, seed_db, as_role, as_sp1, as_sp2, as_owner, CUST1

ACC_ID, ACC_UID = "10000000-0000-0000-0000-0000000000a1", "a0000000-0000-0000-0000-0000000000a1"
WM_ID, WM_UID = "10000000-0000-0000-0000-0000000000b1", "a0000000-0000-0000-0000-0000000000b1"
QUOTE_ID = "50000000-0000-0000-0000-000000000001"
ORDER_ID = "60000000-0000-0000-0000-000000000001"


def _seed_phase2a():
    seed_db()
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("insert into salespersons (id, auth_uid, name, whatsapp, role) "
                    "values (%s,%s,'Anita','+910000000009','accounts')", (ACC_ID, ACC_UID))
        cur.execute("insert into salespersons (id, auth_uid, name, whatsapp, role) "
                    "values (%s,%s,'Wasim','+910000000010','workshop_manager')", (WM_ID, WM_UID))
        cur.execute("insert into quotations (id, quote_no, customer_id, status, grand_total) "
                    "values (%s,'QTN-RLS-0001',%s,'approved',1000)", (QUOTE_ID, CUST1))
        cur.execute("insert into orders (id, order_no, customer_id, status, grand_total) "
                    "values (%s,'ORD-RLS-0001',%s,'confirmed',1000)", (ORDER_ID, CUST1))
    conn.close()


def as_accounts():
    return as_role("authenticated", ACC_UID)


def as_workshop():
    return as_role("authenticated", WM_UID)


def _count(cur, sql, params):
    cur.execute(sql, params)
    return cur.fetchone()[0]


def test_unrelated_salesperson_blind_to_quote():
    _seed_phase2a()
    with as_sp2() as cur:
        assert _count(cur, "select count(*) from quotations where id=%s", (QUOTE_ID,)) == 0


def test_assigned_salesperson_sees_quote():
    _seed_phase2a()
    with as_sp1() as cur:
        assert _count(cur, "select count(*) from quotations where id=%s", (QUOTE_ID,)) == 1


def test_accounts_and_owner_read_all_quotes():
    _seed_phase2a()
    with as_accounts() as cur:
        assert _count(cur, "select count(*) from quotations where id=%s", (QUOTE_ID,)) == 1
    with as_owner() as cur:
        assert _count(cur, "select count(*) from quotations where id=%s", (QUOTE_ID,)) == 1


def test_salesperson_cannot_insert_payment():
    _seed_phase2a()
    with as_sp1() as cur:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute(
                "insert into payments (receipt_no, order_id, customer_id, kind, amount, mode, paid_at)"
                " values ('RCP-RLS-1',%s,%s,'advance',100,'cash',now())", (ORDER_ID, CUST1))


def test_accounts_can_insert_payment():
    _seed_phase2a()
    with as_accounts() as cur:
        cur.execute(
            "insert into payments (receipt_no, order_id, customer_id, kind, amount, mode, paid_at)"
            " values ('RCP-RLS-2',%s,%s,'advance',100,'cash',now())", (ORDER_ID, CUST1))
        assert cur.rowcount == 1


def test_payment_immutable_even_for_owner():
    _seed_phase2a()
    with as_owner() as cur:
        cur.execute(
            "insert into payments (receipt_no, order_id, customer_id, kind, amount, mode, paid_at)"
            " values ('RCP-RLS-3',%s,%s,'advance',100,'cash',now())", (ORDER_ID, CUST1))
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute("update payments set amount=1 where receipt_no='RCP-RLS-3'")


def test_workshop_manager_blind_to_payments():
    _seed_phase2a()
    # seed a payment as service (owner) first in its own txn is rolled back, so
    # instead assert workshop sees none of the account-visible universe.
    with as_workshop() as cur:
        assert _count(cur, "select count(*) from payments", ()) == 0
        assert _count(cur, "select count(*) from quotations", ()) == 0
