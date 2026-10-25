"""POST /quotations with salesperson_id, and DELETE by an admin (0052).

Pinned here:
  * a dispatcher (front desk, admin, owner-level) may prepare a quotation FOR an active
    salesperson: created_by = that salesperson, prepared_by = the caller, and the
    salesperson is made to see it (ensure_assigned) — q_select is assignment-scoped
  * the front desk must name the salesperson; it never owns a quotation itself
  * the front desk may quote ANY customer — no assignment needed
  * a salesperson cannot attribute a quotation to someone else
  * a plain create (no salesperson_id) is unchanged: created_by = caller, no prepared_by
  * an admin cannot delete a quotation (removes nothing); the owner still can
  * after creating, the front desk may change (edit/revise/send/delete) ONLY the
    quotations it prepared — not every quotation in the showroom
  * a missing customer is 404, not a 500 from the assignment insert

Collaborators stubbed — no DB, no network, no JWT.
"""
import asyncio
from contextlib import asynccontextmanager
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, quotations
from src.repositories import assignment_repo, quotation_repo
from src.services import numbering

CALLER = str(uuid4())
RAVI = uuid4()
CUSTOMER = uuid4()


@pytest.fixture
def wired(monkeypatch):
    state = {
        "role": "front_desk",
        "assigned": False,
        "selling": {str(RAVI)},
        "create_calls": [],
        "ensure_calls": [],
        "soft_deleted": [],
        "committed": False,
        "prepared_by": CALLER,
        "ensure_error": None,
    }

    class _S:
        async def commit(self):
            state["committed"] = True

    @asynccontextmanager
    async def _session():
        yield _S()

    async def _resolve_caller(session, auth_uid):
        return authz.Caller(salesperson_id=CALLER, role=state["role"])

    async def _is_assigned(session, salesperson_id, customer_id):
        return state["assigned"]

    async def _get_selling_staff(session, salesperson_id):
        return {"id": salesperson_id, "name": "Ravi"} if str(salesperson_id) in state["selling"] else None

    async def _ensure_assigned(session, *, customer_id, salesperson_id, added_by):
        if state["ensure_error"]:
            raise state["ensure_error"]
        state["ensure_calls"].append((str(customer_id), str(salesperson_id), str(added_by)))
        return "primary"

    async def _allocate(session, series):
        return "QTN-0052-0001"

    async def _create_returning(session, **kw):
        state["create_calls"].append(kw)
        return {"id": str(uuid4()), **kw}

    async def _get_write_context(session, quotation_id):
        return {"customer_id": CUSTOMER, "prepared_by": state["prepared_by"]}

    async def _soft_delete_draft(session, quotation_id):
        state["soft_deleted"].append(str(quotation_id))
        return True

    monkeypatch.setattr(quotations, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve_caller)
    monkeypatch.setattr(authz, "_is_assigned", _is_assigned)
    monkeypatch.setattr(assignment_repo, "get_selling_staff", _get_selling_staff)
    monkeypatch.setattr(assignment_repo, "ensure_assigned", _ensure_assigned)
    monkeypatch.setattr(numbering, "allocate", _allocate)
    monkeypatch.setattr(quotation_repo, "create_quotation_returning", _create_returning)
    monkeypatch.setattr(quotation_repo, "get_write_context", _get_write_context)
    monkeypatch.setattr(quotation_repo, "soft_delete_draft", _soft_delete_draft)
    return state


def _create(salesperson_id=RAVI):
    req = quotations.QuoteCreate(
        customer_id=CUSTOMER,
        items=[{"description": "Sofa", "qty": Decimal(1), "unit_price": Decimal(1000),
                "hsn": "9401", "gst_rate": Decimal(18)}],
        salesperson_id=salesperson_id,
    )
    return asyncio.run(quotations.create_quotation(req, caller_uid="uid"))


def _delete():
    return asyncio.run(quotations.delete_quotation(uuid4(), caller_uid="uid"))


# ─── on behalf ────────────────────────────────────────────────────────────────

def test_front_desk_prepares_a_quotation_for_a_salesperson(wired):
    _create()

    [call] = wired["create_calls"]
    assert call["created_by"] == RAVI
    assert call["prepared_by"] == UUID(CALLER)
    assert wired["ensure_calls"] == [(str(CUSTOMER), str(RAVI), CALLER)]
    assert wired["committed"]


def test_front_desk_needs_no_assignment_to_the_customer(wired):
    wired["assigned"] = False
    _create()
    assert len(wired["create_calls"]) == 1


def test_front_desk_must_name_the_salesperson(wired):
    with pytest.raises(HTTPException) as exc:
        _create(salesperson_id=None)
    assert exc.value.status_code == 422
    assert wired["create_calls"] == []


@pytest.mark.parametrize("role", ["owner", "super_admin", "admin"])
def test_other_dispatchers_may_prepare_on_behalf(wired, role):
    wired["role"] = role
    _create()
    assert wired["create_calls"][0]["created_by"] == RAVI


def test_target_must_be_an_active_salesperson(wired):
    wired["selling"] = set()
    with pytest.raises(HTTPException) as exc:
        _create()
    assert exc.value.status_code == 422
    assert wired["ensure_calls"] == [] and wired["create_calls"] == []


def test_salesperson_cannot_attribute_a_quotation_to_someone_else(wired):
    wired["role"] = "salesperson"
    wired["assigned"] = True
    with pytest.raises(HTTPException) as exc:
        _create()
    assert exc.value.status_code == 403
    assert wired["create_calls"] == []


def test_plain_create_is_unchanged(wired):
    wired["role"] = "salesperson"
    wired["assigned"] = True

    _create(salesperson_id=None)

    [call] = wired["create_calls"]
    assert call["created_by"] == UUID(CALLER)
    assert call["prepared_by"] is None
    assert wired["ensure_calls"] == []


# ─── admin removes nothing ────────────────────────────────────────────────────

def test_admin_cannot_delete_a_quotation(wired):
    wired["role"] = "admin"
    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 403
    assert wired["soft_deleted"] == []


@pytest.mark.parametrize("role", ["owner", "super_admin", "front_desk"])
def test_others_with_write_access_may_delete_a_draft(wired, role):
    wired["role"] = role
    _delete()
    assert len(wired["soft_deleted"]) == 1


# ─── the front desk changes only what it prepared ─────────────────────────────

def test_front_desk_cannot_delete_a_quotation_it_did_not_prepare(wired):
    wired["prepared_by"] = None   # a salesperson's own quotation
    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 403
    assert wired["soft_deleted"] == []


def test_front_desk_cannot_revise_a_quotation_it_did_not_prepare(wired):
    wired["prepared_by"] = str(uuid4())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(quotations.revise_quotation(uuid4(), caller_uid="uid"))
    assert exc.value.status_code == 403


def test_owner_may_delete_a_quotation_someone_else_prepared(wired):
    wired["role"] = "owner"
    wired["prepared_by"] = str(uuid4())
    _delete()
    assert len(wired["soft_deleted"]) == 1


def test_missing_customer_is_404(wired):
    wired["ensure_error"] = LookupError("customer not found")
    with pytest.raises(HTTPException) as exc:
        _create()
    assert exc.value.status_code == 404
    assert wired["create_calls"] == []


def test_customer_who_withdrew_consent_is_409(wired):
    wired["ensure_error"] = assignment_repo.ConsentWithdrawn("withdrawn")
    with pytest.raises(HTTPException) as exc:
        _create()
    assert exc.value.status_code == 409
    assert wired["create_calls"] == []
