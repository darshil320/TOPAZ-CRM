"""services.storage.signed_urls_async — the batch signed-read contract.

This is the function that turned an N-photo gallery from N sequential HTTPS
round-trips into one, so the two things worth pinning down are:

  1. every key is signed in ONE request, with duplicates collapsed;
  2. PARTIAL SUCCESS. Supabase reports per-path failures inside a 200 body. A key
     that failed must be ABSENT from the result, not raise — one dead storage key
     costs one placeholder tile, never the whole page. A transport failure (the
     request itself) still raises StorageError, because then nothing is known.

No network: a stub stands in for the shared httpx.AsyncClient.
"""
import asyncio

import httpx
import pytest

from src.config import get_settings
from src.services import storage

BUCKET = "media"


class _StubResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=None)  # type: ignore[arg-type]

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _StubClient:
    """Records every POST so a test can assert the batching, not just the output."""

    def __init__(self, response):
        self._response = response
        self.calls: list[tuple[str, dict]] = []

    async def post(self, url, json=None, headers=None):
        self.calls.append((url, json or {}))
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


def _run(coro):
    return asyncio.run(coro)


def test_signs_every_key_in_one_request(monkeypatch):
    stub = _install(
        monkeypatch,
        _StubResponse(
            [
                {"path": "a.jpg", "signedURL": "/object/sign/media/a.jpg?token=1", "error": None},
                {"path": "b.jpg", "signedURL": "/object/sign/media/b.jpg?token=2", "error": None},
            ]
        ),
    )

    out = _run(storage.signed_urls_async(BUCKET, ["a.jpg", "b.jpg"], 3600))

    assert len(stub.calls) == 1, "the whole point is one round-trip"
    url, body = stub.calls[0]
    assert url.endswith(f"/storage/v1/object/sign/{BUCKET}")
    assert body == {"expiresIn": 3600, "paths": ["a.jpg", "b.jpg"]}
    assert out == {
        "a.jpg": "https://project.supabase.co/storage/v1/object/sign/media/a.jpg?token=1",
        "b.jpg": "https://project.supabase.co/storage/v1/object/sign/media/b.jpg?token=2",
    }


def test_duplicate_keys_are_signed_once(monkeypatch):
    """A catalog photo shared by five lines must not be signed five times."""
    stub = _install(
        monkeypatch,
        _StubResponse([{"path": "shared.jpg", "signedURL": "/object/sign/media/shared.jpg?t=1"}]),
    )

    out = _run(storage.signed_urls_async(BUCKET, ["shared.jpg", "shared.jpg", "shared.jpg"]))

    assert stub.calls[0][1]["paths"] == ["shared.jpg"]
    assert list(out) == ["shared.jpg"]


def test_failed_path_is_omitted_not_raised(monkeypatch):
    """Storage reports per-path errors in a 200 body. The good keys must survive."""
    _install(
        monkeypatch,
        _StubResponse(
            [
                {"path": "good.jpg", "signedURL": "/object/sign/media/good.jpg?t=1", "error": None},
                {"path": "gone.jpg", "signedURL": None, "error": "Object not found"},
            ]
        ),
    )

    out = _run(storage.signed_urls_async(BUCKET, ["good.jpg", "gone.jpg"]))

    assert list(out) == ["good.jpg"]


def test_empty_key_list_makes_no_request(monkeypatch):
    stub = _install(monkeypatch, _StubResponse([]))

    assert _run(storage.signed_urls_async(BUCKET, [])) == {}
    assert _run(storage.signed_urls_async(BUCKET, ["", None])) == {}  # type: ignore[list-item]
    assert stub.calls == []


def test_transport_failure_raises(monkeypatch):
    """Nothing is known about any key — the caller must not render an empty gallery
    as though the order had no photos."""
    _install(monkeypatch, httpx.ConnectError("no route to host"))

    with pytest.raises(storage.StorageError):
        _run(storage.signed_urls_async(BUCKET, ["a.jpg"]))


def test_non_list_body_raises(monkeypatch):
    _install(monkeypatch, _StubResponse({"unexpected": "shape"}))

    with pytest.raises(storage.StorageError):
        _run(storage.signed_urls_async(BUCKET, ["a.jpg"]))


def test_non_json_body_raises(monkeypatch):
    _install(monkeypatch, _StubResponse(ValueError("not json")))

    with pytest.raises(storage.StorageError):
        _run(storage.signed_urls_async(BUCKET, ["a.jpg"]))


def test_unconfigured_storage_raises(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "SUPABASE_SERVICE_ROLE_KEY", "")

    with pytest.raises(storage.StorageError):
        _run(storage.signed_urls_async(BUCKET, ["a.jpg"]))
