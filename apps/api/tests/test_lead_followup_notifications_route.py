"""GET/POST /leads/notifications — list, clear, clear-all.

Mirrors test_leads_route.py's wired-fixture style: monkeypatch get_api_session,
authz.resolve_caller, lead_followup_repo.* — no DB, no network, no JWT.

Scope: a salesperson sees/clears only their own notifications; the owner
sees/clears all (§ "my leads only" decision, locked by the user).
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, lead_followup_notifications as routes
from src.repositories import lead_followup_repo

SELF = str(uuid4())
OTHER = str(uuid4())
NOTIF_ID = uuid4()


@pytest.fixture
def wired(monkeypatch):
    state = {
        "notification": {
            "id": str(NOTIF_ID), "lead_id": str(uuid4()), "salesperson_id": SELF,
            "due_on": "2026-10-01", "created_at": "2026-10-01T00:00:00Z", "cleared_at": None,
        },
        "caller": authz.Caller(salesperson_id=SELF, role="salesperson"),
        "list_calls": [],
        "clear_calls": [],
        "clear_all_calls": [],
        "committed": False,
    }

    class _S:
        async def commit(self):
            state["committed"] = True

    @asynccontextmanager
    async def _session():
        yield _S()

    async def _resolve_caller(session, auth_uid):
        return state["caller"]

    async def _list_notifications(session, *, salesperson_id):
        state["list_calls"].append(salesperson_id)
        all_rows = [state["notification"]] if state["notification"] else []
        if salesperson_id is None:
            return all_rows
        return [r for r in all_rows if r["salesperson_id"] == salesperson_id]

    async def _unread_count(session, *, salesperson_id):
        all_rows = [state["notification"]] if state["notification"] else []
        rows = all_rows if salesperson_id is None else [
            r for r in all_rows if r["salesperson_id"] == salesperson_id
        ]
        return len([r for r in rows if r["cleared_at"] is None])

    async def _get_notification(session, notification_id):
        n = state["notification"]
        return n if n and n["id"] == str(notification_id) else None

    async def _clear_notification(session, notification_id):
        state["clear_calls"].append(str(notification_id))
        state["notification"] = {**state["notification"], "cleared_at": "2026-10-02T00:00:00Z"}
        return state["notification"]

    async def _clear_all(session, *, salesperson_id):
        state["clear_all_calls"].append(salesperson_id)
        return 1

    monkeypatch.setattr(routes, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve_caller)
    monkeypatch.setattr(lead_followup_repo, "list_notifications", _list_notifications)
    monkeypatch.setattr(lead_followup_repo, "unread_count", _unread_count)
    monkeypatch.setattr(lead_followup_repo, "get_notification", _get_notification)
    monkeypatch.setattr(lead_followup_repo, "clear_notification", _clear_notification)
    monkeypatch.setattr(lead_followup_repo, "clear_all", _clear_all)
    return state


def _as(state, *, role="salesperson", salesperson_id=SELF):
    state["caller"] = authz.Caller(salesperson_id=salesperson_id, role=role)


def _list():
    return asyncio.run(routes.list_notifications(auth_uid="uid"))


def _clear(notification_id=None):
    return asyncio.run(routes.clear_notification(notification_id or uuid4(), auth_uid="uid"))


def _clear_all():
    return asyncio.run(routes.clear_all(auth_uid="uid"))


# ─── list ─────────────────────────────────────────────────────────────────────

def test_salesperson_sees_only_their_own(wired):
    _as(wired, salesperson_id=SELF)

    out = _list()

    assert wired["list_calls"] == [SELF]
    assert len(out["notifications"]) == 1
    assert out["unread_count"] == 1


def test_non_owner_scoped_to_someone_elses_notifications_sees_none(wired):
    _as(wired, salesperson_id=OTHER)

    out = _list()

    assert wired["list_calls"] == [OTHER]
    assert out["notifications"] == []
    assert out["unread_count"] == 0


def test_owner_sees_all(wired):
    _as(wired, role="owner", salesperson_id=OTHER)

    out = _list()

    assert wired["list_calls"] == [None]
    assert len(out["notifications"]) == 1


# ─── clear ────────────────────────────────────────────────────────────────────

def test_owner_of_notification_may_clear_it(wired):
    _as(wired, salesperson_id=SELF)

    out = _clear(NOTIF_ID)

    assert wired["clear_calls"] == [str(NOTIF_ID)]
    assert out["cleared_at"] is not None


def test_owner_role_may_clear_anyones_notification(wired):
    _as(wired, role="owner", salesperson_id=OTHER)

    _clear(NOTIF_ID)

    assert wired["clear_calls"] == [str(NOTIF_ID)]


def test_someone_elses_notification_is_refused(wired):
    _as(wired, salesperson_id=OTHER)

    with pytest.raises(HTTPException) as exc:
        _clear(NOTIF_ID)
    assert exc.value.status_code == 403
    assert wired["clear_calls"] == [], "a refused clear must not reach the repository"


def test_unknown_notification_is_404(wired):
    wired["notification"] = None

    with pytest.raises(HTTPException) as exc:
        _clear(uuid4())
    assert exc.value.status_code == 404


# ─── clear-all ────────────────────────────────────────────────────────────────

def test_clear_all_scoped_to_caller(wired):
    _as(wired, salesperson_id=SELF)

    out = _clear_all()

    assert wired["clear_all_calls"] == [SELF]
    assert out["cleared"] == 1


def test_clear_all_unscoped_for_owner(wired):
    _as(wired, role="owner", salesperson_id=OTHER)

    _clear_all()

    assert wired["clear_all_calls"] == [None]
