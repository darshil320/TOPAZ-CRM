"""0051 telecaller RLS proof. Runs on the temp DB via pgtest.sh.

The telecaller's "edit any lead" right lives in the API only (authz.py, behind the
LeadUpdate field whitelist). Direct PostgREST writes must stay as narrow as any
salesperson's, or a telecaller's own JWT could re-point created_by / skip the status
machine on every lead. Proven here:
  - salespersons.role accepts 'telecaller'; a misspelling is still rejected
  - leads_update is NOT widened: a telecaller cannot update a lead they did not
    capture, and cannot re-point created_by on one they did
  - a telecaller cannot delete a lead (leads has no delete policy, by design)
"""
import psycopg2
import pytest

from tests.rls_support import DB_URL, SP1_ID, seed_db, as_role, as_service

TC_ID, TC_UID = "10000000-0000-0000-0000-0000000000c1", "a0000000-0000-0000-0000-0000000000c1"
OTHERS_LEAD = "70000000-0000-0000-0000-000000000001"
OWN_LEAD = "70000000-0000-0000-0000-000000000002"


def _seed():
    seed_db()
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        # 0046 grants nothing explicitly; prod `authenticated` holds full table rights on
        # leads via Supabase's default privileges, which this temp cluster lacks. Mirror
        # prod so the POLICY is what decides, not a missing grant.
        cur.execute("grant select, insert, update, delete on leads to authenticated")
        cur.execute("delete from leads")
        cur.execute("insert into salespersons (id, auth_uid, name, whatsapp, role) "
                    "values (%s,%s,'Pooja','+910000000011','telecaller')", (TC_ID, TC_UID))
        cur.execute("insert into leads (id, name, phone, created_by) "
                    "values (%s,'Hemant','+919426529230',%s)", (OTHERS_LEAD, SP1_ID))
        cur.execute("insert into leads (id, name, phone, created_by) "
                    "values (%s,'Nita','+919426529231',%s)", (OWN_LEAD, TC_ID))
    conn.close()


def as_telecaller():
    return as_role("authenticated", TC_UID)


def test_telecaller_cannot_update_others_lead_directly():
    _seed()
    with as_telecaller() as cur:
        cur.execute("update leads set name = 'Corrected' where id = %s", (OTHERS_LEAD,))
        assert cur.rowcount == 0


def test_telecaller_may_update_own_lead_directly():
    _seed()
    with as_telecaller() as cur:
        cur.execute("update leads set name = 'Corrected' where id = %s", (OWN_LEAD,))
        assert cur.rowcount == 1


def test_telecaller_cannot_repoint_created_by():
    _seed()
    with as_telecaller() as cur:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute("update leads set created_by = %s where id = %s", (SP1_ID, OWN_LEAD))


def test_telecaller_cannot_delete_a_lead():
    _seed()
    with as_telecaller() as cur:
        cur.execute("delete from leads where id in (%s, %s)", (OTHERS_LEAD, OWN_LEAD))
        assert cur.rowcount == 0
    with as_service() as cur:
        cur.execute("select count(*) from leads")
        assert cur.fetchone()[0] == 2


def test_misspelled_role_is_rejected():
    _seed()
    with as_service() as cur:
        with pytest.raises(psycopg2.errors.CheckViolation):
            cur.execute("insert into salespersons (name, whatsapp, role) "
                        "values ('X','+910000000099','tellecaller')")
