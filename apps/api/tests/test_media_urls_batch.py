"""POST /api/media/urls — the batch signed-read route.

Exists because `/{media_id}/url` cost a caller lookup + a DB round-trip + an HTTPS
sign PER IMAGE, and the dashboard asks for a whole table or gallery at once.

What is pinned down here is the route's mapping rules, which are where a batch can
quietly do the wrong thing:
  - one caller lookup, one row query, one Storage sign for the whole request;
  - `thumb` prefers thumb_key but falls back to the original when it is NULL,
    and `is_thumb` reports which one came back;
  - a distinct storage key is signed once even when several rows share it;
  - PARTIAL SUCCESS: a row that is not `ready`, is invisible to this role, or whose
    object failed to sign is ABSENT from the response instead of failing it;
  - a Storage-level failure (nothing signed at all) is a 502, not a silent empty map.

No DB and no network: the session, the caller lookup, the repo and Storage are stubs.
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, media
from src.repositories import media_repo
from src.services import storage

CALLER_UID = "34eefce2-6f6f-4a7e-a646-93b8748e3ee1"


def _row(*, media_id, key, thumb_key=None, status="ready", entity_type="order_item"):
    return {
        "id": media_id,
        "entity_type": entity_type,
        "entity_id": uuid4(),
        "kind": "production",
        "storage_key": key,
        "thumb_key": thumb_key,
        "mime": "image/jpeg",
        "bytes": 1234,
        "status": status,
        "stage_code": None,
        "created_by": uuid4(),
        "created_at": "2026-08-05T00:00:00Z",
        "uploaded_at": "2026-08-05T00:00:00Z",
    }


@pytest.fixture
def wired(monkeypatch):
    """Stub the route's four collaborators and record what they were asked for."""
    state = {"rows": [], "role": "owner", "signed": {}, "sign_error": None,
             "sign_calls": [], "row_queries": [], "caller_lookups": 0}

    @asynccontextmanager
    async def _session():
        yield object()

    async def _resolve_caller(session, uid):
        state["caller_lookups"] += 1
        return authz.Caller(salesperson_id=str(uuid4()), role=state["role"])

    async def _get_media_many(session, ids):
        state["row_queries"].append(list(ids))
        wanted = {str(i) for i in ids}
        return [r for r in state["rows"] if str(r["id"]) in wanted]

    async def _signed_urls_async(bucket, keys, expires_in=3600):
        state["sign_calls"].append(list(keys))
        if state["sign_error"] is not None:
            raise state["sign_error"]
        return {k: state["signed"][k] for k in keys if k in state["signed"]}

    monkeypatch.setattr(media, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve_caller)
    monkeypatch.setattr(media_repo, "get_media_many", _get_media_many)
    monkeypatch.setattr(storage, "signed_urls_async", _signed_urls_async)
    return state


def _call(media_ids, thumb=True):
    req = media.UrlsRequest(media_ids=media_ids, thumb=thumb)
    return asyncio.run(media.media_urls(req, caller_uid=CALLER_UID))


def test_one_lookup_one_query_one_sign_for_many_images(wired):
    ids = [uuid4() for _ in range(3)]
    wired["rows"] = [_row(media_id=i, key=f"{i}.jpg") for i in ids]
    wired["signed"] = {f"{i}.jpg": f"https://signed/{i}" for i in ids}

    out = _call(ids)

    assert wired["caller_lookups"] == 1
    assert len(wired["row_queries"]) == 1
    assert len(wired["sign_calls"]) == 1
    assert set(out["urls"]) == {str(i) for i in ids}
    assert all(v["url"].startswith("https://signed/") for v in out["urls"].values())


def test_thumb_preferred_and_reported(wired):
    with_thumb, without = uuid4(), uuid4()
    wired["rows"] = [
        _row(media_id=with_thumb, key="full-a.jpg", thumb_key="thumb-a.jpg"),
        _row(media_id=without, key="full-b.jpg", thumb_key=None),
    ]
    wired["signed"] = {
        "thumb-a.jpg": "https://signed/thumb-a",
        "full-b.jpg": "https://signed/full-b",
    }

    out = _call([with_thumb, without], thumb=True)

    assert out["urls"][str(with_thumb)] == {"url": "https://signed/thumb-a", "is_thumb": True}
    # thumb_key is NULL — the original is served, and is_thumb says so honestly.
    assert out["urls"][str(without)] == {"url": "https://signed/full-b", "is_thumb": False}


def test_thumb_false_signs_the_original(wired):
    media_id = uuid4()
    wired["rows"] = [_row(media_id=media_id, key="full.jpg", thumb_key="thumb.jpg")]
    wired["signed"] = {"full.jpg": "https://signed/full"}

    out = _call([media_id], thumb=False)

    assert wired["sign_calls"] == [["full.jpg"]]
    assert out["urls"][str(media_id)]["is_thumb"] is False


def test_shared_storage_key_signed_once(wired):
    a, b = uuid4(), uuid4()
    wired["rows"] = [_row(media_id=a, key="shared.jpg"), _row(media_id=b, key="shared.jpg")]
    wired["signed"] = {"shared.jpg": "https://signed/shared"}

    out = _call([a, b])

    # Both media ids resolve, off one signature.
    assert out["urls"][str(a)]["url"] == out["urls"][str(b)]["url"] == "https://signed/shared"


def test_duplicate_ids_collapse_before_the_query(wired):
    media_id = uuid4()
    wired["rows"] = [_row(media_id=media_id, key="a.jpg")]
    wired["signed"] = {"a.jpg": "https://signed/a"}

    _call([media_id, media_id, media_id])

    assert wired["row_queries"] == [[media_id]]


def test_pending_row_omitted(wired):
    ready, pending = uuid4(), uuid4()
    wired["rows"] = [
        _row(media_id=ready, key="ready.jpg"),
        _row(media_id=pending, key="pending.jpg", status="pending"),
    ]
    wired["signed"] = {"ready.jpg": "https://signed/ready", "pending.jpg": "https://signed/pending"}

    out = _call([ready, pending])

    assert list(out["urls"]) == [str(ready)]
    assert wired["sign_calls"] == [["ready.jpg"]], "a pending row must not cost a signature"


def test_missing_row_omitted(wired):
    present, absent = uuid4(), uuid4()
    wired["rows"] = [_row(media_id=present, key="a.jpg")]
    wired["signed"] = {"a.jpg": "https://signed/a"}

    out = _call([present, absent])

    assert list(out["urls"]) == [str(present)]


@pytest.mark.parametrize("role", ["workshop_manager", "delivery"])
def test_customer_media_hidden_from_production_roles(wired, role):
    """Mirrors the media_select RLS policy — and the single-image route's own rule."""
    customer_photo, item_photo = uuid4(), uuid4()
    wired["role"] = role
    wired["rows"] = [
        _row(media_id=customer_photo, key="cust.jpg", entity_type="customer"),
        _row(media_id=item_photo, key="item.jpg", entity_type="order_item"),
    ]
    wired["signed"] = {"cust.jpg": "https://signed/cust", "item.jpg": "https://signed/item"}

    out = _call([customer_photo, item_photo])

    assert list(out["urls"]) == [str(item_photo)]


def test_customer_media_visible_to_sales_roles(wired):
    customer_photo = uuid4()
    wired["role"] = "salesperson"
    wired["rows"] = [_row(media_id=customer_photo, key="cust.jpg", entity_type="customer")]
    wired["signed"] = {"cust.jpg": "https://signed/cust"}

    out = _call([customer_photo])

    assert list(out["urls"]) == [str(customer_photo)]


def test_unsignable_key_omitted_not_fatal(wired):
    """One dead storage key costs one placeholder tile, not the gallery."""
    good, gone = uuid4(), uuid4()
    wired["rows"] = [_row(media_id=good, key="good.jpg"), _row(media_id=gone, key="gone.jpg")]
    wired["signed"] = {"good.jpg": "https://signed/good"}

    out = _call([good, gone])

    assert list(out["urls"]) == [str(good)]


def test_no_visible_rows_returns_empty_without_signing(wired):
    wired["rows"] = []

    out = _call([uuid4()])

    assert out == {"urls": {}}
    assert wired["sign_calls"] == []


def test_storage_outage_is_a_502(wired):
    media_id = uuid4()
    wired["rows"] = [_row(media_id=media_id, key="a.jpg")]
    wired["sign_error"] = storage.StorageError("Storage not configured")

    with pytest.raises(HTTPException) as exc:
        _call([media_id])
    assert exc.value.status_code == 502


def test_request_model_bounds_the_batch():
    """An unbounded list would let one call fan out arbitrarily on Supabase's side."""
    with pytest.raises(Exception):
        media.UrlsRequest(media_ids=[])
    with pytest.raises(Exception):
        media.UrlsRequest(media_ids=[uuid4() for _ in range(101)])
    assert media.UrlsRequest(media_ids=[uuid4()]).thumb is True


def test_media_ids_are_uuids_not_free_text():
    with pytest.raises(Exception):
        media.UrlsRequest(media_ids=["'; drop table media; --"])
    parsed = media.UrlsRequest(media_ids=[str(CALLER_UID)])
    assert parsed.media_ids == [UUID(CALLER_UID)]
