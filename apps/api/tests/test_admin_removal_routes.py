"""0052: every removal route refuses an admin — before it touches anything.

Admin sees and edits everything but removes nothing. These routes are reached from the
owner/admin settings screens, which an admin can now open, so hiding the buttons is not
enough: the API gate (authz.assert_may_remove) is what holds. A session that explodes on
use proves the refusal happens before any read or write.
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, routing, transfers, workshops


class _Untouchable:
    def __getattr__(self, name):
        raise AssertionError(f"an admin removal touched the session ({name})")


@pytest.fixture
def as_admin(monkeypatch):
    @asynccontextmanager
    async def _session():
        yield _Untouchable()

    async def _resolve_caller(session, auth_uid):
        return authz.Caller(salesperson_id=str(uuid4()), role="admin")

    for module in (workshops, routing, transfers):
        monkeypatch.setattr(module, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve_caller)


ROUTES = {
    "deactivate a workshop": lambda: workshops.deactivate_workshop(uuid4(), caller_uid="uid"),
    "remove workshop staff": lambda: workshops.remove_staff(uuid4(), uuid4(), caller_uid="uid"),
    "retire a route template": lambda: routing.deactivate_template(uuid4(), caller_uid="uid"),
    "cancel a consignment": lambda: transfers.cancel(
        uuid4(), transfers.CancelRequest(reason="wrong lorry"), caller_uid="uid"),
}


@pytest.mark.parametrize("action", sorted(ROUTES))
def test_admin_is_refused_before_anything_is_read_or_written(as_admin, action):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ROUTES[action]())
    assert exc.value.status_code == 403
    assert action in exc.value.detail
