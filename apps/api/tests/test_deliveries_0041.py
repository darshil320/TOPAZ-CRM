"""0041 (promoted 2026-10-25): the single-order delivery write path is retired.

Runs on the temp DB via pgtest.sh. A lorry run is now created ONLY through
schedule_delivery(jsonb), which authorizes every order in the basket itself:
  - the old per-order schedule_delivery signatures no longer exist
  - a browser JWT cannot INSERT into deliveries or delivery_items directly, even the owner
"""
import psycopg2
import pytest

from tests.rls_support import as_owner, as_service, as_sp1, seed_db


@pytest.fixture(autouse=True)
def seeded():
    seed_db()


def test_only_the_jsonb_schedule_delivery_remains():
    with as_service() as cur:
        cur.execute(
            "select pg_get_function_identity_arguments(oid) from pg_proc"
            " where proname = 'schedule_delivery'"
        )
        signatures = [r[0] for r in cur.fetchall()]
    assert signatures == ["p_delivery jsonb"]


@pytest.mark.parametrize("persona", [as_owner, as_sp1])
def test_browser_cannot_insert_a_delivery_directly(persona):
    with persona() as cur:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute("insert into deliveries (status, scheduled_date) values ('scheduled', current_date)")


@pytest.mark.parametrize("persona", [as_owner, as_sp1])
def test_browser_cannot_insert_a_delivery_item_directly(persona):
    with persona() as cur:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute("insert into delivery_items (delivery_id, order_item_id)"
                        " values (gen_random_uuid(), gen_random_uuid())")
