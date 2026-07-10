"""Shared constants + persona helpers for the RLS test suite.

These tests prove the §19-H security boundary by talking to the LOCAL Supabase
Postgres directly and impersonating each role exactly the way Supabase does at
runtime: `set local role <authenticated|anon>` + `set local request.jwt.claims`
(auth.uid() reads the 'sub' claim). No Auth server or JWT signing needed — we are
testing the POLICIES, not the login flow.
"""
import contextlib
import json
import os

import psycopg2

# Local Supabase Postgres (see `supabase status`). Override with TEST_DATABASE_URL.
DB_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)

# Personas — (internal salespersons.id, Supabase auth_uid)
OWNER_ID, OWNER_UID = "10000000-0000-0000-0000-000000000001", "a0000000-0000-0000-0000-000000000001"
SP1_ID,   SP1_UID   = "10000000-0000-0000-0000-000000000002", "a0000000-0000-0000-0000-000000000002"  # assigned
SP2_ID,   SP2_UID   = "10000000-0000-0000-0000-000000000003", "a0000000-0000-0000-0000-000000000003"  # unrelated

CONSENT1 = "20000000-0000-0000-0000-000000000001"
CONSENT2 = "20000000-0000-0000-0000-000000000002"
CUST1    = "30000000-0000-0000-0000-000000000001"   # assigned to SP1
CUST2    = "30000000-0000-0000-0000-000000000002"   # unclaimed
MSG1     = "40000000-0000-0000-0000-000000000001"   # message on CUST1

ZERO_VEC = "[" + ",".join(["0"] * 512) + "]"          # a dummy 512-d embedding


def seed_db():
    """Wipe + seed a known fixture: owner, two salespersons, CUST1 (assigned to SP1
    with a message/visit/embedding) and CUST2 (unclaimed). Committed so persona
    connections can read it."""
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("""
            truncate salespersons, consents, customers, face_embeddings, visits,
                     customer_assignments, coverage_requests, conversations,
                     pipeline_stages, messages, followups, audit_log
            restart identity cascade;
        """)
        cur.execute("insert into salespersons (id, auth_uid, name, whatsapp, role) "
                    "values (%s,%s,'Owner','+910000000001','owner')", (OWNER_ID, OWNER_UID))
        cur.execute("insert into salespersons (id, auth_uid, name, whatsapp) "
                    "values (%s,%s,'Ramesh','+910000000002')", (SP1_ID, SP1_UID))
        cur.execute("insert into salespersons (id, auth_uid, name, whatsapp) "
                    "values (%s,%s,'Suresh','+910000000003')", (SP2_ID, SP2_UID))
        cur.execute("insert into consents (id, face_tracking, personal_data, whatsapp_marketing, method) "
                    "values (%s,true,true,true,'kiosk')", (CONSENT1,))
        cur.execute("insert into consents (id, face_tracking, personal_data, whatsapp_marketing, method) "
                    "values (%s,true,true,true,'kiosk')", (CONSENT2,))
        cur.execute("insert into customers (id, consent_id, name) values (%s,%s,'Ravi')", (CUST1, CONSENT1))
        cur.execute("insert into customers (id, consent_id, name) values (%s,%s,'Walk-in')", (CUST2, CONSENT2))
        cur.execute("insert into customer_assignments (customer_id, salesperson_id, role, active) "
                    "values (%s,%s,'primary',true)", (CUST1, SP1_ID))
        cur.execute("insert into messages (id, customer_id, direction, content, sender_type) "
                    "values (%s,%s,'inbound','hi','customer')", (MSG1, CUST1))
        cur.execute("insert into visits (customer_id, salesperson_id, match_band, raw_event_id) "
                    "values (%s,%s,'REPEAT', gen_random_uuid())", (CUST1, SP1_ID))
        cur.execute("insert into visits (customer_id, match_band, raw_event_id) "
                    "values (%s,'NEW', gen_random_uuid())", (CUST2,))
        cur.execute("insert into face_embeddings (customer_id, embedding) values (%s, %s::vector)",
                    (CUST1, ZERO_VEC))
    conn.close()


@contextlib.contextmanager
def as_role(role, auth_uid=None):
    """Run statements as a Supabase role in a transaction that is always rolled back
    (so test writes never persist). `role` is one of our own literals — never user input."""
    assert role in ("authenticated", "anon")
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute(f"set local role {role}")
    claims = {"role": role}
    if auth_uid:
        claims["sub"] = auth_uid
    cur.execute("set local request.jwt.claims = %s", (json.dumps(claims),))
    try:
        yield cur
    finally:
        conn.rollback()
        cur.close()
        conn.close()


@contextlib.contextmanager
def as_service():
    """Superuser connection = the backend (FastAPI/Celery). Bypasses RLS. Rolled back."""
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        yield cur
    finally:
        conn.rollback()
        cur.close()
        conn.close()


def as_owner():  return as_role("authenticated", OWNER_UID)
def as_sp1():    return as_role("authenticated", SP1_UID)
def as_sp2():    return as_role("authenticated", SP2_UID)
def as_anon():   return as_role("anon")
