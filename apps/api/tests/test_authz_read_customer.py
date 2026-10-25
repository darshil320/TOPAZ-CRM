"""authz.assert_can_read_customer — who may read a customer's documents.

owner/admin/accounts read any customer; a salesperson or a telecaller (0051 — "sees
everything a salesperson sees") only their assigned customers; workshop/delivery
never. Assignment lookup stubbed — no DB.
"""
import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api import authz

CUSTOMER = str(uuid4())


@pytest.fixture
def assigned(monkeypatch):
    state = {"assigned": False}

    async def _is_assigned(session, salesperson_id, customer_id):
        return state["assigned"]

    monkeypatch.setattr(authz, "_is_assigned", _is_assigned)
    return state


def _read(role):
    caller = authz.Caller(salesperson_id=str(uuid4()), role=role)
    return asyncio.run(authz.assert_can_read_customer(None, caller, CUSTOMER))


@pytest.mark.parametrize("role", ["owner", "admin", "accounts"])
def test_finance_roles_read_any_customer(assigned, role):
    _read(role)


@pytest.mark.parametrize("role", ["salesperson", "telecaller"])
def test_sales_roles_read_their_assigned_customer(assigned, role):
    assigned["assigned"] = True
    _read(role)


@pytest.mark.parametrize("role", ["salesperson", "telecaller"])
def test_sales_roles_are_refused_an_unassigned_customer(assigned, role):
    with pytest.raises(HTTPException) as exc:
        _read(role)
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["workshop_manager", "delivery"])
def test_other_roles_are_refused_even_when_assigned(assigned, role):
    assigned["assigned"] = True
    with pytest.raises(HTTPException) as exc:
        _read(role)
    assert exc.value.status_code == 403
