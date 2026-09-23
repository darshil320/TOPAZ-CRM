"""POST/GET /leads/{id}/recordings — sign-upload, complete, list.

Mirrors test_leads_route.py's wired-fixture style: monkeypatch get_api_session,
authz.resolve_caller, lead_repo.get_lead, lead_recording_repo.*, and storage.* —
no DB, no network, no JWT.

Gating mirrors assert_can_edit_lead exactly (creator + owner only may sign-upload
or complete); listing is open to any active salesperson, matching leads_select.
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


@pytest.fixture
def wired(monkeypatch):
    state = {
        "lead": {"id": str(LEAD_ID), "created_by": CREATOR, "assigned_to": OTHER},
        "recording": None,  # set per-test for complete/list cases
        "caller": authz.Caller(salesperson_id=CREATOR, role="salesperson"),
        "create_calls": [],
        "mark_ready_calls": [],
        "mark_failed_calls": [],
        "object_size": 1000,  # storage.object_size_async return value
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

    async def _get_lead(session, lead_id):
        return state["lead"]

    async def _create_pending(session, **kwargs):
        state["create_calls"].append(kwargs)
        row = {
            # lead_id as a real UUID object, NOT str — this is what asyncpg actually
            # returns for a uuid column, and comparing it to a plain str with `!=`
            # is always True even for matching ids (the exact bug this regression
            # test exists to catch: every /complete call 404'd unconditionally).
            "id": str(kwargs["recording_id"]), "lead_id": UUID(str(kwargs["lead_id"])),
            "storage_key": kwargs["storage_key"], "mime": kwargs["mime"],
            "bytes": None, "duration_seconds": None, "note": kwargs.get("note"),
            "status": "pending", "created_by": kwargs.get("created_by"),
            "created_at": "2026-01-01T00:00:00Z", "uploaded_at": None,
        }
        state["recording"] = row
        return row

    async def _get_recording(session, recording_id):
        return state["recording"]

    async def _mark_ready(session, recording_id, *, size_bytes):
        state["mark_ready_calls"].append({"id": str(recording_id), "size_bytes": size_bytes})
        state["recording"] = {**state["recording"], "status": "ready", "bytes": size_bytes}
        return state["recording"]

    async def _mark_failed(session, recording_id):
        state["mark_failed_calls"].append(str(recording_id))

    async def _list_for_lead(session, lead_id, **kwargs):
        return state.get("list_result", [])

    async def _signed_upload_url_async(bucket, key, ttl):
        return f"https://storage.example/{bucket}/{key}?sig=upload"

    async def _object_size_async(bucket, key):
        return state["object_size"]

    async def _signed_urls_async(bucket, keys, ttl):
        return {k: f"https://storage.example/{bucket}/{k}?sig=read" for k in keys}

    monkeypatch.setattr(lead_recordings, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve_caller)
    monkeypatch.setattr(lead_recordings, "lead_repo", type("M", (), {"get_lead": staticmethod(_get_lead)}))
    monkeypatch.setattr(lead_recording_repo, "create_pending", _create_pending)
    monkeypatch.setattr(lead_recording_repo, "get_recording", _get_recording)
    monkeypatch.setattr(lead_recording_repo, "mark_ready", _mark_ready)
    monkeypatch.setattr(lead_recording_repo, "mark_failed", _mark_failed)
    monkeypatch.setattr(lead_recording_repo, "list_for_lead", _list_for_lead)
    monkeypatch.setattr(storage, "signed_upload_url_async", _signed_upload_url_async)
    monkeypatch.setattr(storage, "object_size_async", _object_size_async)
    monkeypatch.setattr(storage, "signed_urls_async", _signed_urls_async)
    return state


def _as(state, *, role="salesperson", salesperson_id=CREATOR):
    state["caller"] = authz.Caller(salesperson_id=salesperson_id, role=role)


def _sign(mime="audio/mpeg", note=None, lead_id=None):
    body = lead_recordings.SignUploadRequest(mime=mime, note=note)
    return asyncio.run(lead_recordings.sign_upload(lead_id or LEAD_ID, body, auth_uid="uid"))


def _complete(recording_id=None, bytes_=1000, lead_id=None):
    body = lead_recordings.CompleteRequest(bytes=bytes_)
    return asyncio.run(
        lead_recordings.complete_upload(
            lead_id or LEAD_ID, recording_id or uuid4(), body, auth_uid="uid"
        )
    )


def _list(lead_id=None):
    return asyncio.run(lead_recordings.list_recordings(lead_id or LEAD_ID, auth_uid="uid"))


# ─── sign-upload ──────────────────────────────────────────────────────────────

def test_creator_may_sign_upload(wired):
    _as(wired, salesperson_id=CREATOR)

    out = _sign(mime="audio/mpeg", note="follow-up call")

    assert str(wired["create_calls"][0]["created_by"]) == CREATOR
    assert wired["create_calls"][0]["note"] == "follow-up call"
    assert out["storage_key"].endswith(".mp3")
    assert wired["committed"]


def test_owner_may_sign_upload(wired):
    _as(wired, role="owner", salesperson_id=OTHER)

    _sign()

    assert len(wired["create_calls"]) == 1


def test_non_creator_non_owner_is_refused(wired):
    _as(wired, salesperson_id=OTHER)

    with pytest.raises(HTTPException) as exc:
        _sign()
    assert exc.value.status_code == 403
    assert wired["create_calls"] == []
    assert not wired["committed"]


def test_unknown_mime_is_422_before_any_storage_or_db_call(wired):
    calls = []
    wired_storage_calls = wired["create_calls"]

    with pytest.raises(HTTPException) as exc:
        _sign(mime="audio/aac")
    assert exc.value.status_code == 422
    assert wired_storage_calls == []


def test_missing_lead_is_404(wired):
    wired["lead"] = None

    with pytest.raises(HTTPException) as exc:
        _sign()
    assert exc.value.status_code == 404


# ─── complete ─────────────────────────────────────────────────────────────────

def test_complete_marks_ready_with_actual_size(wired):
    _as(wired, salesperson_id=CREATOR)
    _sign()
    recording_id = wired["recording"]["id"]
    wired["object_size"] = 5000

    out = _complete(recording_id=recording_id, bytes_=1)  # claimed size ignored

    assert wired["mark_ready_calls"][0]["size_bytes"] == 5000
    assert out["status"] == "ready"


def test_complete_is_idempotent_on_already_ready(wired):
    _as(wired, salesperson_id=CREATOR)
    _sign()
    recording_id = wired["recording"]["id"]
    wired["recording"] = {**wired["recording"], "status": "ready"}

    out = _complete(recording_id=recording_id)

    assert out["status"] == "ready"
    assert wired["mark_ready_calls"] == []


def test_complete_oversize_marks_failed_and_422s(wired):
    _as(wired, salesperson_id=CREATOR)
    _sign()
    recording_id = wired["recording"]["id"]
    wired["object_size"] = 999_999_999

    with pytest.raises(HTTPException) as exc:
        _complete(recording_id=recording_id)
    assert exc.value.status_code == 422
    assert wired["mark_failed_calls"] == [recording_id]


def test_complete_missing_object_marks_failed_and_409s(wired):
    _as(wired, salesperson_id=CREATOR)
    _sign()
    recording_id = wired["recording"]["id"]
    wired["object_size"] = None

    with pytest.raises(HTTPException) as exc:
        _complete(recording_id=recording_id)
    assert exc.value.status_code == 409
    assert wired["mark_failed_calls"] == [recording_id]


def test_complete_is_gated_same_as_sign_upload(wired):
    _as(wired, salesperson_id=CREATOR)
    _sign()
    recording_id = wired["recording"]["id"]

    _as(wired, salesperson_id=OTHER)
    with pytest.raises(HTTPException) as exc:
        _complete(recording_id=recording_id)
    assert exc.value.status_code == 403
    assert wired["mark_ready_calls"] == []


def test_complete_missing_recording_is_404(wired):
    wired["recording"] = None
    with pytest.raises(HTTPException) as exc:
        _complete()
    assert exc.value.status_code == 404


# ─── list ─────────────────────────────────────────────────────────────────────

def test_list_is_open_to_any_active_salesperson(wired):
    """Not creator/owner gated — matches leads_select's open read."""
    _as(wired, salesperson_id=OTHER)
    wired["list_result"] = [
        {"id": "r1", "storage_key": "x/1.mp3", "note": None, "duration_seconds": None,
         "bytes": 100, "created_at": "t", "created_by": CREATOR, "uploaded_by_name": "Hemant"},
    ]

    out = _list()

    assert len(out["recordings"]) == 1
    assert out["recordings"][0]["url"].startswith("https://storage.example/")


def test_list_missing_lead_is_404(wired):
    wired["lead"] = None
    with pytest.raises(HTTPException) as exc:
        _list()
    assert exc.value.status_code == 404


def test_list_empty_is_fine(wired):
    wired["list_result"] = []
    out = _list()
    assert out["recordings"] == []
