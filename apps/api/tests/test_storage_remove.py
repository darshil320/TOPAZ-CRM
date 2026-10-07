"""services.storage.remove_objects_async — bulk delete for a private bucket.

Used when a lead is deleted: its call recordings live in the lead-audio bucket, and
the DB cascade on lead_recordings drops the only record of their keys. The objects
must go first, and a failure must RAISE so the caller aborts before losing the keys.

No network: a stub stands in for the shared httpx.AsyncClient.
"""
import asyncio

import httpx
import pytest

from src.config import get_settings
from src.services import storage

BUCKET = "lead-audio"


class _StubResponse:
    def __init__(self, status_code=200):
        self.status_code = status_code


class _StubClient:
    def __init__(self, response):
        self._response = response
        self.calls: list[tuple[str, dict]] = []

    async def request(self, method, url, json=None, headers=None):
        self.calls.append((method, url, json or {}))
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


@pytest.fixture(autouse=True)
def storage_configured():
    s = get_settings()
    s.SUPABASE_URL = "https://project.supabase.co"
    s.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests"
    return s


def _install(monkeypatch, response) -> _StubClient:
    stub = _StubClient(response)

    async def _client():
        return stub

    monkeypatch.setattr(storage, "_client", _client)
    return stub


def test_removes_every_key_in_one_request(monkeypatch):
    stub = _install(monkeypatch, _StubResponse(200))

    asyncio.run(storage.remove_objects_async(BUCKET, ["a.webm", "b.webm", "a.webm"]))

    assert len(stub.calls) == 1
    method, url, body = stub.calls[0]
    assert method == "DELETE"
    assert url.endswith(f"/storage/v1/object/{BUCKET}")
    assert body == {"prefixes": ["a.webm", "b.webm"]}


def test_empty_key_list_makes_no_request(monkeypatch):
    stub = _install(monkeypatch, _StubResponse(200))

    asyncio.run(storage.remove_objects_async(BUCKET, []))
    asyncio.run(storage.remove_objects_async(BUCKET, ["", None]))  # type: ignore[list-item]

    assert stub.calls == []


def test_http_error_raises(monkeypatch):
    _install(monkeypatch, _StubResponse(500))

    with pytest.raises(storage.StorageError):
        asyncio.run(storage.remove_objects_async(BUCKET, ["a.webm"]))


def test_transport_failure_raises(monkeypatch):
    _install(monkeypatch, httpx.ConnectError("no route to host"))

    with pytest.raises(storage.StorageError):
        asyncio.run(storage.remove_objects_async(BUCKET, ["a.webm"]))


def test_unconfigured_storage_raises(monkeypatch):
    monkeypatch.setattr(get_settings(), "SUPABASE_SERVICE_ROLE_KEY", "")

    with pytest.raises(storage.StorageError):
        asyncio.run(storage.remove_objects_async(BUCKET, ["a.webm"]))
