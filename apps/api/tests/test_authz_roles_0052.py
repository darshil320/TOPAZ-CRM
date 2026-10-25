"""0052 role groups at the API boundary — super_admin, admin, front_desk.

The API runs on the service-role connection, so these gates ARE the authorization
boundary for every route (RLS does not apply there). Pure — assignment lookup stubbed.
"""
import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, lead_followup_notifications, payments, production, transfers
from src.services import roles, stage_flow

CUSTOMER = str(uuid4())


def _caller(role):
    return authz.Caller(salesperson_id=str(uuid4()), role=role)


@pytest.fixture
def assigned(monkeypatch):
    state = {"assigned": False}

    async def _is_assigned(session, salesperson_id, customer_id):
        return state["assigned"]

    monkeypatch.setattr(authz, "_is_assigned", _is_assigned)
    return state


# ─── the groups mirror 0052's SQL helpers ─────────────────────────────────────

def test_role_groups_nest():
    assert roles.OWNER_LEVEL == {"owner", "super_admin"}
    assert roles.VIEW_ALL == roles.OWNER_LEVEL | {"admin"}
    assert roles.DISPATCH == roles.VIEW_ALL | {"front_desk"}
    assert roles.NO_REMOVAL == {"admin"}


@pytest.mark.parametrize("role,expected", [
    ("owner", True), ("super_admin", True), ("admin", False), ("front_desk", False),
])
def test_caller_is_owner_means_owner_level(role, expected):
    assert _caller(role).is_owner is expected


@pytest.mark.parametrize("role", ["owner", "super_admin", "admin"])
def test_caller_is_admin_covers_every_view_all_role(role):
    assert _caller(role).is_admin


# ─── super_admin inherits every owner-level grant ─────────────────────────────

def test_super_admin_gets_every_workshop_capability():
    assert stage_flow.capabilities_for(role="super_admin", staff_role=None) == \
        stage_flow.capabilities_for(role="owner", staff_role=None)
    assert "super_admin" in stage_flow.ROSTER_IRRELEVANT_ROLES


def test_super_admin_may_record_refund_allocate_and_drive():
    assert "super_admin" in payments._PAYMENT_ROLES
    assert "super_admin" in payments._ELEVATED_ROLES
    assert "super_admin" in production._ALLOCATING_ROLES
    assert "super_admin" in transfers._COURIER_ROLES


def test_super_admin_sees_and_clears_every_notification():
    assert lead_followup_notifications._scope(_caller("super_admin")) is None
    authz.assert_can_clear_notification(_caller("super_admin"), {"salesperson_id": str(uuid4())})


# ─── admin removes nothing ────────────────────────────────────────────────────

def test_admin_may_not_remove():
    with pytest.raises(HTTPException) as exc:
        authz.assert_may_remove(_caller("admin"), action="cancel an order")
    assert exc.value.status_code == 403
    assert "cancel an order" in exc.value.detail


@pytest.mark.parametrize("role", ["owner", "super_admin", "salesperson", "front_desk"])
def test_everyone_else_passes_the_removal_gate(role):
    authz.assert_may_remove(_caller(role), action="delete a quotation")


# ─── front desk ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["owner", "super_admin", "admin", "front_desk"])
def test_dispatchers_may_attach(role):
    authz.assert_dispatcher(_caller(role), action="attach a walk-in")


@pytest.mark.parametrize("role", ["salesperson", "telecaller", "accounts", "delivery"])
def test_non_dispatchers_may_not_attach(role):
    with pytest.raises(HTTPException) as exc:
        authz.assert_dispatcher(_caller(role), action="attach a walk-in")
    assert exc.value.status_code == 403


def test_front_desk_writes_a_quote_for_any_customer(assigned):
    asyncio.run(authz.assert_can_write_quote(None, _caller("front_desk"), CUSTOMER))


def test_front_desk_does_not_get_order_writes(assigned):
    """Quotations only — orders/job cards/production stay on assert_can_write_customer."""
    with pytest.raises(HTTPException) as exc:
        asyncio.run(authz.assert_can_write_customer(None, _caller("front_desk"), CUSTOMER))
    assert exc.value.status_code == 403


def test_salesperson_quote_write_still_needs_assignment(assigned):
    with pytest.raises(HTTPException):
        asyncio.run(authz.assert_can_write_quote(None, _caller("salesperson"), CUSTOMER))
    assigned["assigned"] = True
    asyncio.run(authz.assert_can_write_quote(None, _caller("salesperson"), CUSTOMER))
