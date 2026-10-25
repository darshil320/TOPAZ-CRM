"""0052 RLS proof — super_admin, admin-sees-everything, front_desk.
Runs on the temp DB via pgtest.sh.

  - super_admin is owner-level everywhere is_owner() is used; only a super_admin may
    add/change/remove a super_admin row
  - admin sees every customer, thread and visit, may edit, and can delete nothing
  - front_desk sees every customer, quotation and staff name, but not WhatsApp threads;
    it assigns walk-ins (API) and never claims one
  - the walk-in queue is unchanged (0007): every salesperson sees and may claim every
    unclaimed walk-in
"""
import psycopg2
import pytest

from tests.rls_support import (
    CUST1, CUST2, DB_URL, SP1_ID, SP2_ID,
    as_owner, as_role, as_service, as_sp1, as_sp2, seed_db,
)

SUPER_ID, SUPER_UID = "10000000-0000-0000-0000-0000000000d1", "a0000000-0000-0000-0000-0000000000d1"
ADMIN_ID, ADMIN_UID = "10000000-0000-0000-0000-0000000000d2", "a0000000-0000-0000-0000-0000000000d2"
FD_ID, FD_UID = "10000000-0000-0000-0000-0000000000d3", "a0000000-0000-0000-0000-0000000000d3"
CONSENT3 = "20000000-0000-0000-0000-0000000000d1"
CUST3 = "30000000-0000-0000-0000-0000000000d1"     # a second unclaimed walk-in
QUOTE1 = "50000000-0000-0000-0000-0000000000d1"     # on CUST1


def _seed():
    seed_db()
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        for sid, uid, name, wa, role in (
            (SUPER_ID, SUPER_UID, "Super", "+910000000021", "super_admin"),
            (ADMIN_ID, ADMIN_UID, "Admin", "+910000000022", "admin"),
            (FD_ID, FD_UID, "Desk", "+910000000023", "front_desk"),
        ):
            cur.execute("insert into salespersons (id, auth_uid, name, whatsapp, role) "
                        "values (%s,%s,%s,%s,%s)", (sid, uid, name, wa, role))
        cur.execute("insert into consents (id, face_tracking, personal_data, whatsapp_marketing, method) "
                    "values (%s,false,true,false,'app')", (CONSENT3,))
        cur.execute("insert into customers (id, consent_id, name) values (%s,%s,'Second walk-in')",
                    (CUST3, CONSENT3))
        cur.execute("insert into quotations (id, quote_no, customer_id, status, grand_total, created_by) "
                    "values (%s,'QTN-0052-0001',%s,'draft',1000,%s)", (QUOTE1, CUST1, SP1_ID))
    conn.close()


@pytest.fixture(autouse=True)
def seeded():
    _seed()


def as_super():
    return as_role("authenticated", SUPER_UID)


def as_admin():
    return as_role("authenticated", ADMIN_UID)


def as_front_desk():
    return as_role("authenticated", FD_UID)


def _ids(cur, sql, params=()):
    cur.execute(sql, params)
    return {str(r[0]) for r in cur.fetchall()}


ALL_CUSTOMERS = {CUST1, CUST2, CUST3}


# ─── super_admin ────────────────────────────────────────────────────────────

def test_super_admin_sees_every_customer_like_the_owner():
    with as_super() as cur:
        assert _ids(cur, "select id from customers") == ALL_CUSTOMERS


def test_super_admin_has_the_owner_only_toggles():
    with as_super() as cur:
        cur.execute("update customers set ai_autosend = true where id = %s", (CUST1,))
        assert cur.rowcount == 1


def test_owner_cannot_touch_a_super_admin_row():
    with as_owner() as cur:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute("update salespersons set active = false where id = %s", (SUPER_ID,))


def test_owner_cannot_promote_anyone_to_super_admin():
    with as_owner() as cur:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute("update salespersons set role = 'super_admin' where id = %s", (SP1_ID,))


def test_super_admin_may_add_another_super_admin():
    with as_super() as cur:
        cur.execute("insert into salespersons (name, whatsapp, role) "
                    "values ('Second','+910000000029','super_admin')")
        assert cur.rowcount == 1


# ─── admin ──────────────────────────────────────────────────────────────────

def test_admin_sees_every_customer_and_thread():
    with as_admin() as cur:
        assert _ids(cur, "select id from customers") == ALL_CUSTOMERS
        cur.execute("select count(*) from messages where customer_id = %s", (CUST1,))
        assert cur.fetchone()[0] == 1
        cur.execute("select count(*) from visits where customer_id = %s", (CUST1,))
        assert cur.fetchone()[0] == 1


def test_admin_may_edit_any_customer():
    with as_admin() as cur:
        cur.execute("update customers set primary_interest = 'Sofa' where id = %s", (CUST1,))
        assert cur.rowcount == 1


def test_admin_may_assign_a_customer():
    with as_admin() as cur:
        cur.execute("insert into customer_assignments (customer_id, salesperson_id, role, active) "
                    "values (%s,%s,'collaborator',true)", (CUST1, SP2_ID))
        assert cur.rowcount == 1


def test_admin_cannot_delete_a_quotation_but_owner_can():
    with as_admin() as cur:
        cur.execute("delete from quotations where id = %s", (QUOTE1,))
        assert cur.rowcount == 0
    with as_owner() as cur:
        cur.execute("delete from quotations where id = %s", (QUOTE1,))
        assert cur.rowcount == 1


def test_admin_cannot_manage_staff():
    with as_admin() as cur:
        cur.execute("update salespersons set active = false where id = %s", (SP1_ID,))
        assert cur.rowcount == 0


# ─── front_desk ─────────────────────────────────────────────────────────────

def test_front_desk_sees_every_customer_quote_and_staff_name():
    with as_front_desk() as cur:
        assert _ids(cur, "select id from customers") == ALL_CUSTOMERS
        assert QUOTE1 in _ids(cur, "select id from quotations")
        assert {SP1_ID, SP2_ID} <= _ids(cur, "select id from salespersons")


def test_front_desk_sees_who_is_assigned():
    with as_front_desk() as cur:
        assert _ids(cur, "select salesperson_id from customer_assignments "
                         "where customer_id = %s", (CUST1,)) == {SP1_ID}


def test_front_desk_does_not_read_whatsapp_threads():
    with as_front_desk() as cur:
        cur.execute("select count(*) from messages")
        assert cur.fetchone()[0] == 0


# ─── walk-in queue (unchanged from 0007) ──────────────────────────────────────

@pytest.mark.parametrize("persona", [as_sp1, as_sp2])
def test_every_salesperson_still_sees_every_unclaimed_walk_in(persona):
    with persona() as cur:
        visible = _ids(cur, "select id from customers")
        assert {CUST2, CUST3} <= visible
        cur.execute("select count(*) from visits where customer_id = %s", (CUST2,))
        assert cur.fetchone()[0] == 1


@pytest.mark.parametrize("persona", [as_sp1, as_sp2])
def test_any_salesperson_may_claim_an_unclaimed_walk_in(persona):
    with persona() as cur:
        cur.execute("select claim_customer(%s)", (CUST3,))
        assert cur.fetchone()[0] is True


def test_owner_may_still_claim():
    with as_owner() as cur:
        cur.execute("select claim_customer(%s)", (CUST3,))
        assert cur.fetchone()[0] is True


def test_front_desk_sees_unclaimed_visits():
    with as_front_desk() as cur:
        cur.execute("select count(*) from visits where customer_id = %s", (CUST2,))
        assert cur.fetchone()[0] == 1


def test_service_role_is_not_blocked_by_the_super_admin_guard():
    with as_service() as cur:
        cur.execute("update salespersons set active = false where id = %s", (SUPER_ID,))
        assert cur.rowcount == 1


# ─── review hardening ─────────────────────────────────────────────────────────

def test_front_desk_assigns_but_never_claims():
    """A claim would make it primary and hand it the customer's WhatsApp thread."""
    for cust in (CUST2, CUST3):
        with as_front_desk() as cur:
            with pytest.raises(psycopg2.errors.InsufficientPrivilege):
                cur.execute("select claim_customer(%s)", (cust,))


def test_admin_cannot_soft_delete_through_an_update():
    with as_admin() as cur:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute("update quotations set status = 'expired' where id = %s", (QUOTE1,))
    with as_admin() as cur:
        cur.execute("update quotations set notes = 'edited' where id = %s", (QUOTE1,))
        assert cur.rowcount == 1, "edits stay allowed"


def test_admin_cannot_deactivate_a_product_but_may_reactivate():
    with as_service() as cur:
        cur.execute("insert into products (name, hsn, gst_rate, active) values ('Sofa','9401',18,true) returning id")
        live = cur.fetchone()[0]
        cur.connection.commit()
    try:
        with as_admin() as cur:
            with pytest.raises(psycopg2.errors.InsufficientPrivilege):
                cur.execute("update products set active = false where id = %s", (live,))
        with as_owner() as cur:
            cur.execute("update products set active = false where id = %s", (live,))
            assert cur.rowcount == 1
    finally:
        with as_service() as cur:
            cur.execute("delete from products where id = %s", (live,))
            cur.connection.commit()


def test_released_customer_can_be_reclaimed_by_the_same_salesperson():
    with as_service() as cur:
        cur.execute("insert into customer_assignments (customer_id, salesperson_id, role, active) "
                    "values (%s,%s,'primary',false)", (CUST2, SP2_ID))
        cur.connection.commit()
    with as_sp2() as cur:
        cur.execute("select claim_customer(%s)", (CUST2,))
        assert cur.fetchone()[0] is True


def test_staff_cannot_mint_a_face_tracking_consent():
    with as_admin() as cur:
        with pytest.raises(psycopg2.Error):
            cur.execute("insert into consents (face_tracking, personal_data, whatsapp_marketing, method) "
                        "values (true,true,false,'kiosk')")


def test_admin_cannot_repoint_a_customers_consent():
    with as_admin() as cur:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute("update customers set consent_id = %s where id = %s", (CONSENT3, CUST1))


def test_front_desk_does_not_see_customer_photos():
    key = "customer/0052-test/site.jpg"
    with as_service() as cur:
        cur.execute("insert into media (entity_type, entity_id, kind, storage_key, mime, status) "
                    "values ('customer', %s, 'site', %s, 'image/jpeg', 'ready')", (CUST1, key))
        cur.connection.commit()
    try:
        with as_front_desk() as cur:
            cur.execute("select count(*) from media where storage_key = %s", (key,))
            assert cur.fetchone()[0] == 0
        with as_admin() as cur:
            cur.execute("select count(*) from media where storage_key = %s", (key,))
            assert cur.fetchone()[0] == 1
    finally:
        with as_service() as cur:
            cur.execute("delete from media where storage_key = %s", (key,))
            cur.connection.commit()


def test_unclaimed_view_lists_only_unclaimed_customers():
    for persona in (as_front_desk, as_sp1, as_owner):
        with persona() as cur:
            assert _ids(cur, "select id from unclaimed_walkins") == {CUST2, CUST3}


def test_a_customer_who_withdrew_consent_cannot_be_claimed_and_leaves_the_board():
    with as_service() as cur:
        cur.execute("update consents set withdrawn_at = now() where id = %s", (CONSENT3,))
        cur.connection.commit()
    with as_sp1() as cur:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute("select claim_customer(%s)", (CUST3,))
    with as_front_desk() as cur:
        assert CUST3 not in _ids(cur, "select id from unclaimed_walkins")
