"""RLS security-boundary tests (§19-H, release-blocking).

Each test impersonates a role and asserts what it may / may not see or do.
A failure here means a real cross-salesperson data leak — treat as release-blocking.

Run against a local Supabase:  supabase start && supabase db reset
Then:                          pytest apps/api/tests/test_rls.py -v
"""
import psycopg2
import pytest

from rls_support import (
    as_anon, as_owner, as_service, as_sp1, as_sp2,
    CUST1, CUST2, SP2_ID, ZERO_VEC,
)

pytestmark = pytest.mark.usefixtures("seeded")


# ── Tenant isolation: a salesperson sees only their assigned customers ──────────
def test_assigned_sp_sees_their_customer():
    with as_sp1() as cur:
        cur.execute("select id from customers where id = %s", (CUST1,))
        assert cur.fetchone() is not None

def test_unrelated_sp_is_blind_to_customer():
    with as_sp2() as cur:
        cur.execute("select id from customers where id = %s", (CUST1,))
        assert cur.fetchone() is None            # RLS hides it entirely

def test_assigned_sp_sees_the_thread():
    with as_sp1() as cur:
        cur.execute("select count(*) from messages where customer_id = %s", (CUST1,))
        assert cur.fetchone()[0] == 1

def test_unrelated_sp_is_blind_to_the_thread():
    with as_sp2() as cur:
        cur.execute("select count(*) from messages where customer_id = %s", (CUST1,))
        assert cur.fetchone()[0] == 0


# ── CRITICAL-1: no self-assigning onto someone else's customer ──────────────────
def test_unrelated_sp_cannot_self_assign():
    with as_sp2() as cur:
        with pytest.raises(psycopg2.Error):     # owner-only ca_insert policy blocks it
            cur.execute(
                "insert into customer_assignments (customer_id, salesperson_id, role, active) "
                "values (%s, %s, 'primary', true)", (CUST1, SP2_ID))


# ── Atomic claim: first tap wins, second gets False ─────────────────────────────
def test_claim_unclaimed_customer_succeeds():
    with as_sp2() as cur:
        cur.execute("select claim_customer(%s)", (CUST2,))
        assert cur.fetchone()[0] is True

def test_claim_already_claimed_returns_false():
    with as_sp2() as cur:
        cur.execute("select claim_customer(%s)", (CUST1,))   # SP1 already holds primary
        assert cur.fetchone()[0] is False


# ── 0007: unclaimed walk-in queue — any active salesperson can see + claim ──────
def test_unassigned_sp_sees_unclaimed_customer():
    with as_sp2() as cur:
        cur.execute("select id from customers where id = %s", (CUST2,))
        assert cur.fetchone() is not None

def test_unassigned_sp_sees_unclaimed_customers_visit():
    with as_sp2() as cur:
        cur.execute("select count(*) from visits where customer_id = %s", (CUST2,))
        assert cur.fetchone()[0] == 1

def test_owner_sees_unclaimed_customer_too():
    with as_owner() as cur:
        cur.execute("select id from customers where id = %s", (CUST2,))
        assert cur.fetchone() is not None

def test_unrelated_sp_still_blind_to_assigned_customers_visit():
    with as_sp2() as cur:
        cur.execute("select count(*) from visits where customer_id = %s", (CUST1,))
        assert cur.fetchone()[0] == 0


# ── Biometric data is never browser-readable ────────────────────────────────────
def test_salesperson_cannot_read_face_embeddings():
    with as_sp1() as cur:
        cur.execute("select count(*) from face_embeddings")
        assert cur.fetchone()[0] == 0            # RLS on, no policy → zero rows


# ── Owner-only AI toggles (trigger-enforced) ────────────────────────────────────
def test_salesperson_cannot_flip_ai_autosend():
    with as_sp1() as cur:
        with pytest.raises(psycopg2.Error):
            cur.execute("update customers set ai_autosend = true where id = %s", (CUST1,))

def test_owner_can_flip_ai_autosend():
    with as_owner() as cur:
        cur.execute("update customers set ai_autosend = true where id = %s", (CUST1,))
        assert cur.rowcount == 1

def test_salesperson_can_take_over_handler():   # manual override IS allowed
    with as_sp1() as cur:
        cur.execute(
            "update customers set handler_mode = 'human', handler_salesperson_id = %s "
            "where id = %s", (SP2_ID, CUST1))    # any salesperson value; the point is it's permitted
        assert cur.rowcount == 1


# ── anon (the consent kiosk) can do exactly one thing ───────────────────────────
def test_anon_can_insert_consent():
    with as_anon() as cur:
        cur.execute("insert into consents (face_tracking, personal_data, whatsapp_marketing, method) "
                    "values (false, false, false, 'kiosk') returning id")
        assert cur.fetchone() is not None

def test_anon_is_blind_to_customers():
    with as_anon() as cur:
        cur.execute("select count(*) from customers")
        assert cur.fetchone()[0] == 0


# ── audit_log is append-only for authenticated (no update path) ─────────────────
def test_audit_log_not_updatable_by_authenticated():
    with as_owner() as cur:
        cur.execute("update audit_log set action = 'tampered'")
        assert cur.rowcount == 0                 # no UPDATE policy → zero rows affected


# ── DPDPA hard gate: no embedding without active face_tracking consent ──────────
def test_consent_gate_blocks_unconsented_embedding():
    with as_service() as cur:                    # even the backend cannot bypass the gate
        cur.execute("insert into consents (face_tracking, personal_data, whatsapp_marketing, method) "
                    "values (false, false, false, 'kiosk') returning id")
        consent_id = cur.fetchone()[0]
        cur.execute("insert into customers (consent_id, name) values (%s, 'NoConsent') returning id",
                    (consent_id,))
        cust = cur.fetchone()[0]
        with pytest.raises(psycopg2.Error):
            cur.execute("insert into face_embeddings (customer_id, embedding) values (%s, %s::vector)",
                        (cust, ZERO_VEC))


# ── MEDIUM-3: message content/sender fields are immutable ───────────────────────
def test_message_content_is_immutable():
    with as_sp1() as cur:
        with pytest.raises(psycopg2.Error):
            cur.execute("update messages set content = 'edited' where customer_id = %s", (CUST1,))
