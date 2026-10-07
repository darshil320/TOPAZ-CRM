"""DELETE /leads/{lead_id}/recordings/{recording_id} — remove one call recording.

Used directly ("delete") and by the dashboard's "replace" flow, which uploads the new
file first and deletes the old one only once the new one is ready.

Pinned here:
  * same gate as adding a recording: lead creator or owner (admin is NOT owner)
  * 404 for a missing lead, a missing recording, or a recording on ANOTHER lead —
    the path's lead_id must own the recording, or the creator gate is bypassable by
    pairing a lead you own with someone else's recording id
  * the Storage object is removed BEFORE the row (the row holds the only copy of the
    key); a Storage failure aborts with 502 — no row delete, no commit

Collaborators stubbed — no DB, no network, no JWT.
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, lead_recordings
from src.repositories import lead_recording_repo
from src.services import storage

CREATOR = str(uuid4())
OTHER = str(uuid4())
LEAD_ID = uuid4()
REC_ID = uuid4()


@pytest.fixture
def wired(monkeypatch):
    state = {
        "lead": {"id": str(LEAD_ID), "created_by": CREATOR, "status": "new"},
        # asyncpg hands back uuid columns as UUID objects — keep it realistic.
        "recording": {
            "id": REC_ID, "lead_id": UUID(str(LEAD_ID)),
            "storage_key": f"leads/{LEAD_ID}/{REC_ID}.mp3", "status": "ready",
        },
        "caller": authz.Caller(salesperson_id=CREATOR, role="salesperson"),
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

    async def _get_recording(session, recording_id):
        return state["recording"]

    async def _remove(bucket, keys):
        state["events"].append(("remove", bucket, list(keys)))
        if state["storage_error"]:
            raise state["storage_error"]

    async def _delete_recording(session, recording_id):
        state["events"].append(("delete", str(recording_id)))
        return True

    monkeypatch.setattr(lead_recordings, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve_caller)
    monkeypatch.setattr(
        lead_recordings, "lead_repo", type("M", (), {"get_lead": staticmethod(_get_lead)})
    )
    monkeypatch.setattr(lead_recording_repo, "get_recording", _get_recording)
    monkeypatch.setattr(lead_recording_repo, "delete_recording", _delete_recording)
    monkeypatch.setattr(storage, "remove_objects_async", _remove)
    return state


def _as(state, *, role="salesperson", salesperson_id=CREATOR):
    state["caller"] = authz.Caller(salesperson_id=salesperson_id, role=role)


def _delete(lead_id=None, recording_id=None):
    return asyncio.run(
        lead_recordings.delete_recording(
            lead_id or LEAD_ID, recording_id or REC_ID, auth_uid="uid"
        )
    )


def _deletes(state):
    return [e for e in state["events"] if isinstance(e, tuple) and e[0] == "delete"]


def test_creator_may_delete_a_recording(wired):
    _delete()

    kinds = [e if isinstance(e, str) else e[0] for e in wired["events"]]
    assert kinds == ["remove", "delete", "commit"], "object first, then row, then commit"
    _, bucket, keys = wired["events"][0]
    assert bucket and keys == [wired["recording"]["storage_key"]]
    assert _deletes(wired) == [("delete", str(REC_ID))]


def test_owner_may_delete_on_anyones_lead(wired):
    _as(wired, role="owner", salesperson_id=OTHER)

    _delete()

    assert len(_deletes(wired)) == 1


@pytest.mark.parametrize("role", ["salesperson", "admin"])
def test_non_creator_is_refused_and_nothing_is_touched(wired, role):
    _as(wired, role=role, salesperson_id=OTHER)

    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 403
    assert wired["events"] == []


def test_missing_lead_is_404(wired):
    wired["lead"] = None

    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 404
    assert wired["events"] == []


def test_missing_recording_is_404(wired):
    wired["recording"] = None

    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 404
    assert wired["events"] == []


def test_recording_on_another_lead_is_404(wired):
    """Owning lead A must not let you delete a recording that belongs to lead B."""
    wired["recording"] = {**wired["recording"], "lead_id": uuid4()}

    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 404
    assert wired["events"] == []


def test_storage_failure_aborts_the_delete(wired):
    wired["storage_error"] = storage.StorageError("boom")

    with pytest.raises(HTTPException) as exc:
        _delete()
    assert exc.value.status_code == 502
    assert _deletes(wired) == []
    assert not wired["committed"]
