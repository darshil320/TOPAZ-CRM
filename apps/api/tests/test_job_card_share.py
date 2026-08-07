"""GET /api/job-cards/{source}/{id}/share — the "send it to anyone" link.

What matters about this route, and what these tests hold:

  * it shares EVERY page. `/url` returns one key, so a 3-page image job card shared
    through it silently shares page 1 — the whole reason this endpoint exists.
  * one batched Storage sign, not one per page.
  * the share is AUDITED. The link needs no login, so "who sent this outside the
    business?" must have an answer.
  * a page that will not sign is dropped, but an empty result is a 502 rather than an
    empty share — a link to nothing is worse than an error.
  * authorization is the same gate as sending: write access to the customer.

Collaborators are stubbed, so no DB and no network.
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, job_cards
from src.config import get_settings
from src.repositories import audit_repo, document_repo
from src.services import storage

CALLER_UID = "34eefce2-6f6f-4a7e-a646-93b8748e3ee1"


@pytest.fixture
def wired(monkeypatch):
    state = {
        "keys": [],
        "alt_keys": [],
        "signed": {},
        "sign_error": None,
        "sign_calls": [],
        "audit": [],
        "authorized": True,
        "customer_id": str(uuid4()),
        "salesperson_id": str(uuid4()),
    }

    async def _authorize(session, caller_uid, source, entity_id):
        if not state["authorized"]:
            raise HTTPException(status_code=403, detail="Not authorized to write this customer's records")
        return (
            authz.Caller(salesperson_id=state["salesperson_id"], role="salesperson"),
            state["customer_id"],
        )

    async def _latest_storage_keys(session, entity_type, entity_id, kind):
        return state["keys"] if kind == job_cards.IMAGE_KIND else state["alt_keys"]

    async def _signed_urls_async(bucket, keys, expires_in=3600):
        state["sign_calls"].append({"keys": list(keys), "expires_in": expires_in})
        if state["sign_error"] is not None:
            raise state["sign_error"]
        return {k: state["signed"][k] for k in keys if k in state["signed"]}

    async def _record(session, **kwargs):
        state["audit"].append(kwargs)

    # The session itself is stubbed by the `commitable_session` fixture.
    monkeypatch.setattr(job_cards, "_authorize", _authorize)
    monkeypatch.setattr(document_repo, "latest_storage_keys", _latest_storage_keys)
    monkeypatch.setattr(storage, "signed_urls_async", _signed_urls_async)
    monkeypatch.setattr(audit_repo, "record", _record)
    return state


@pytest.fixture(autouse=True)
def image_format(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "JOB_CARD_FORMAT", "image")
    monkeypatch.setattr(settings, "JOB_CARD_SHARE_TTL_SECONDS", 604_800)
    return settings


def _call(source="order", entity_id=None):
    return asyncio.run(job_cards.job_card_share(source, entity_id or uuid4(), caller_uid=CALLER_UID))


@pytest.fixture(autouse=True)
def commitable_session(monkeypatch):
    """The route commits the audit row; give the stub session a commit()."""
    class _S:
        async def commit(self):
            self.committed = True

    @asynccontextmanager
    async def _session():
        yield _S()

    monkeypatch.setattr(job_cards, "get_api_session", _session)


def test_every_page_is_shared(wired):
    wired["keys"] = ["job_cards/o1/v2-p01.jpg", "job_cards/o1/v2-p02.jpg", "job_cards/o1/v2-p03.jpg"]
    wired["signed"] = {k: f"https://signed/{i}" for i, k in enumerate(wired["keys"])}

    out = _call()

    assert out["total_pages"] == 3
    assert [p["url"] for p in out["pages"]] == ["https://signed/0", "https://signed/1", "https://signed/2"]
    assert [p["filename"] for p in out["pages"]] == ["v2-p01.jpg", "v2-p02.jpg", "v2-p03.jpg"]


def test_page_order_is_preserved(wired):
    """Page order comes from the key order; the signing map is unordered."""
    wired["keys"] = [f"job_cards/o1/v1-p{n:02d}.jpg" for n in (1, 2, 10)]
    # Deliberately insert the map out of order.
    wired["signed"] = {
        "job_cards/o1/v1-p10.jpg": "https://signed/p10",
        "job_cards/o1/v1-p01.jpg": "https://signed/p01",
        "job_cards/o1/v1-p02.jpg": "https://signed/p02",
    }

    out = _call()

    assert [p["url"] for p in out["pages"]] == [
        "https://signed/p01", "https://signed/p02", "https://signed/p10",
    ]


def test_one_batched_sign_for_all_pages(wired):
    wired["keys"] = [f"k{i}.jpg" for i in range(8)]
    wired["signed"] = {k: f"https://signed/{k}" for k in wired["keys"]}

    _call()

    assert len(wired["sign_calls"]) == 1
    assert wired["sign_calls"][0]["keys"] == wired["keys"]


def test_share_ttl_is_the_share_setting_not_the_default(wired, image_format):
    wired["keys"] = ["k.jpg"]
    wired["signed"] = {"k.jpg": "https://signed/k"}

    out = _call()

    assert wired["sign_calls"][0]["expires_in"] == 604_800
    assert out["expires_in"] == 604_800


def test_share_is_audited(wired):
    wired["keys"] = ["a.jpg", "b.jpg"]
    wired["signed"] = {"a.jpg": "https://s/a", "b.jpg": "https://s/b"}

    _call()

    assert len(wired["audit"]) == 1
    row = wired["audit"][0]
    assert row["action"] == "job_card_shared"
    assert row["actor"] == wired["salesperson_id"]
    assert row["payload"]["pages"] == 2
    assert row["payload"]["customer_id"] == wired["customer_id"]


def test_falls_back_to_the_other_format(wired):
    """JOB_CARD_FORMAT can change after a card was rendered; a PDF already on file
    must still be shareable."""
    wired["keys"] = []
    wired["alt_keys"] = ["job_cards/o1/v1.pdf"]
    wired["signed"] = {"job_cards/o1/v1.pdf": "https://signed/pdf"}

    out = _call()

    assert out["format"] == "pdf"
    assert out["pages"] == [{"url": "https://signed/pdf", "filename": "v1.pdf"}]


def test_not_rendered_yet_is_404(wired):
    wired["keys"] = []
    wired["alt_keys"] = []

    with pytest.raises(HTTPException) as exc:
        _call()
    assert exc.value.status_code == 404
    assert "not generated yet" in exc.value.detail


def test_unsignable_page_is_dropped_but_the_rest_still_share(wired):
    wired["keys"] = ["good.jpg", "gone.jpg"]
    wired["signed"] = {"good.jpg": "https://signed/good"}

    out = _call()

    assert len(out["pages"]) == 1
    # `total_pages` still reports the truth, so the caller can see it is short.
    assert out["total_pages"] == 2


def test_nothing_signable_is_a_502_not_an_empty_share(wired):
    wired["keys"] = ["a.jpg"]
    wired["signed"] = {}

    with pytest.raises(HTTPException) as exc:
        _call()
    assert exc.value.status_code == 502


def test_storage_outage_is_a_502(wired):
    wired["keys"] = ["a.jpg"]
    wired["sign_error"] = storage.StorageError("Storage not configured")

    with pytest.raises(HTTPException) as exc:
        _call()
    assert exc.value.status_code == 502


def test_unauthorized_caller_cannot_share(wired):
    """Same gate as sending — a salesperson may not share another rep's customer."""
    wired["authorized"] = False
    wired["keys"] = ["a.jpg"]
    wired["signed"] = {"a.jpg": "https://s/a"}

    with pytest.raises(HTTPException) as exc:
        _call()
    assert exc.value.status_code == 403
    assert wired["sign_calls"] == [], "must not sign anything for an unauthorized caller"
    assert wired["audit"] == []


def test_bad_source_is_422(wired):
    with pytest.raises(HTTPException) as exc:
        _call(source="invoice")
    assert exc.value.status_code == 422
