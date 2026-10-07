"""DELETE /leads/{id} — removing an enquiry captured against the wrong number.

Pinned here:
  * same gate as edit: creator or owner only (admin is NOT owner)
  * 404 before 403, so an id's existence is never confirmed to a non-creator
  * a converted lead cannot be deleted — it is the history behind a customer row
  * recordings in the lead-audio bucket are removed BEFORE the row: the
    lead_recordings ON DELETE CASCADE drops the only record of their keys, so a
    storage failure must abort the delete (no repo call, no commit), never orphan

Collaborators stubbed — no DB, no network, no JWT.
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, leads
from src.repositories import lead_recording_repo, lead_repo
from src.services import storage

CREATOR = str(uuid4())
OTHER = str(uuid4())


@pytest.fixture
def wired(monkeypatch):
    state = {
        "lead": {"id": str(uuid4()), "status": "new", "created_by": CREATOR},
        "caller": authz.Caller(salesperson_id=CREATOR, role="salesperson"),
        "recordings": [{"storage_key": "leads/x/r1.webm"}, {"storage_key": "leads/x/r2.webm"}],
        "storage_error": None,
        "events": [],
        "committed": False,
    }

    class _S:
        async def commit(self):
            state["events"].append("commit")
            state["committed"] = True

    @asynccontextmanager
    async def _session():
        yield _S()

    async def _resolve_caller(session, auth_uid):
        return state["caller"]

    async def _get_lead(session, lead_id):
        return state["lead"]

    async def _list_for_lead(session, lead_id, *, ready_only=True):
        state["events"].append(("list", ready_only))
        return state["recordings"]

    async def _remove(bucket, keys):
        state["events"].append(("remove", bucket, list(keys)))
        if state["storage_error"]:
            raise state["storage_error"]

    async def _delete_lead(session, lead_id):
        state["events"].append(("delete", str(lead_id)))
        return True

    monkeypatch.setattr(leads, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve_caller)
    monkeypatch.setattr(lead_repo, "get_lead", _get_lead)
    monkeypatch.setattr(lead_repo, "delete_lead", _delete_lead)
    monkeypatch.setattr(lead_recording_repo, "list_for_lead", _list_for_lead)
    monkeypatch.setattr(storage, "remove_objects_async", _remove)
    return state


def _as(state, *, role="salesperson", salesperson_id=CREATOR):
    state["caller"] = authz.Caller(salesperson_id=salesperson_id, role=role)


def _delete(lead_id=None):
    return asyncio.run(leads.delete_lead(lead_id or uuid4(), auth_uid="uid"))


def _deletes(state):
    return [e for e in state["events"] if isinstance(e, tuple) and e[0] == "delete"]


def test_creator_may_delete_their_lead(wired):
    lead_id = uuid4()

    _delete(lead_id)

    assert _deletes(wired) == [("delete", str(lead_id))]
    assert wired["committed"]


def test_owner_may_delete_anyones_lead(wired):
    _as(wired, role="owner", salesperson_id=OTHER)

    _delete()

    assert len(_deletes(wired)) == 1


@pytest.mark.parametrize("role", ["salesperson", "admin"])
def test_non_creator_is_refused_and_nothing_is_touched(wired, role):
    _as(wired, role=role, salesperson_id=OTHER)

    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 403
    assert wired["events"] == [], "a refused delete must not list, remove, delete or commit"


def test_missing_lead_is_404_even_for_a_non_creator(wired):
    wired["lead"] = None
    _as(wired, salesperson_id=OTHER)

    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 404


def test_converted_lead_cannot_be_deleted(wired):
    wired["lead"] = {**wired["lead"], "status": "converted"}

    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 409
    assert _deletes(wired) == []
    assert not wired["committed"]


def test_recordings_are_removed_from_storage_before_the_row(wired):
    _delete()

    kinds = [e if isinstance(e, str) else e[0] for e in wired["events"]]
    assert kinds == ["list", "remove", "delete", "commit"]
    assert wired["events"][0] == ("list", False), "pending/failed uploads have objects too"
    _, bucket, keys = wired["events"][1]
    assert keys == ["leads/x/r1.webm", "leads/x/r2.webm"]
    assert bucket


def test_storage_failure_aborts_the_delete(wired):
    wired["storage_error"] = storage.StorageError("boom")

    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 502
    assert _deletes(wired) == []
    assert not wired["committed"]


def test_lead_without_recordings_skips_storage(wired):
    wired["recordings"] = []

    _delete()

    assert not any(isinstance(e, tuple) and e[0] == "remove" for e in wired["events"])
    assert len(_deletes(wired)) == 1
