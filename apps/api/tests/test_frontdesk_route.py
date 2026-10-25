"""POST /frontdesk/walkins/{id}/assign — the front desk hands a walk-in to a salesperson.

Pinned here:
  * dispatchers only (owner-level, admin, front_desk); a salesperson is refused before
    anything is read or written (they claim from the queue instead)
  * the target must be an ACTIVE salesperson (422 otherwise)
  * a customer already claimed is 409 — the desk cannot take customers from anyone
  * a customer who withdrew consent is 409 (DPDPA: they re-register themselves)
  * a claim landing between the check and the insert is a 409, not a silent overwrite

Collaborators stubbed — no DB, no network, no JWT.
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, frontdesk
from src.repositories import assignment_repo, walkin_repo

RAVI = uuid4()
DESK = str(uuid4())


@pytest.fixture
def wired(monkeypatch):
    state = {
        "role": "front_desk",
        "selling": {str(RAVI)},
        "walkin_state": {"name": "Hemant", "primary_name": None, "consent_withdrawn": False},
        "assign_ok": True,
        "assign_calls": [],
        "committed": False,
    }

    class _S:
        async def commit(self):
            state["committed"] = True

    @asynccontextmanager
    async def _session():
        yield _S()

    async def _resolve_caller(session, auth_uid):
        return authz.Caller(salesperson_id=DESK, role=state["role"])

    async def _get_selling_staff(session, salesperson_id):
        return {"id": salesperson_id, "name": "Ravi"} if str(salesperson_id) in state["selling"] else None

    async def _get_walkin_state(session, customer_id):
        return state["walkin_state"]

    async def _assign_primary(session, *, customer_id, salesperson_id, assigned_by):
        state["assign_calls"].append((str(customer_id), str(salesperson_id), str(assigned_by)))
        return state["assign_ok"]

    monkeypatch.setattr(frontdesk, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve_caller)
    monkeypatch.setattr(assignment_repo, "get_selling_staff", _get_selling_staff)
    monkeypatch.setattr(walkin_repo, "get_walkin_state", _get_walkin_state)
    monkeypatch.setattr(walkin_repo, "assign_primary", _assign_primary)
    return state


def _assign(customer_id=None, salesperson_id=RAVI):
    req = frontdesk.AssignRequest(salesperson_id=salesperson_id)
    return asyncio.run(frontdesk.assign_walkin(customer_id or uuid4(), req, auth_uid="uid"))


def test_front_desk_assigns_a_walk_in(wired):
    customer = uuid4()

    out = _assign(customer)

    assert wired["assign_calls"] == [(str(customer), str(RAVI), DESK)]
    assert out["assigned_to"] == {"id": str(RAVI), "name": "Ravi"}
    assert wired["committed"]


@pytest.mark.parametrize("role", ["owner", "super_admin", "admin"])
def test_other_dispatchers_may_assign(wired, role):
    wired["role"] = role
    _assign()
    assert len(wired["assign_calls"]) == 1


@pytest.mark.parametrize("role", ["salesperson", "telecaller", "accounts", "delivery"])
def test_non_dispatchers_are_refused_before_any_write(wired, role):
    wired["role"] = role
    with pytest.raises(HTTPException) as exc:
        _assign()
    assert exc.value.status_code == 403
    assert wired["assign_calls"] == [] and not wired["committed"]


def test_target_must_be_an_active_salesperson(wired):
    wired["selling"] = set()
    with pytest.raises(HTTPException) as exc:
        _assign()
    assert exc.value.status_code == 422
    assert wired["assign_calls"] == []


def test_unknown_customer_is_404(wired):
    wired["walkin_state"] = None
    with pytest.raises(HTTPException) as exc:
        _assign()
    assert exc.value.status_code == 404


def test_claimed_customer_is_409(wired):
    wired["walkin_state"] = {**wired["walkin_state"], "primary_name": "Suresh"}
    with pytest.raises(HTTPException) as exc:
        _assign()
    assert exc.value.status_code == 409
    assert "Suresh" in exc.value.detail
    assert wired["assign_calls"] == []


def test_withdrawn_consent_is_409(wired):
    wired["walkin_state"] = {**wired["walkin_state"], "consent_withdrawn": True}
    with pytest.raises(HTTPException) as exc:
        _assign()
    assert exc.value.status_code == 409
    assert "consent" in exc.value.detail
    assert wired["assign_calls"] == []


def test_a_claim_racing_the_assign_is_409(wired):
    wired["assign_ok"] = False
    with pytest.raises(HTTPException) as exc:
        _assign()
    assert exc.value.status_code == 409
    assert not wired["committed"]
