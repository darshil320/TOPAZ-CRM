"""POST/GET /quotations/{id}/pdf — the dashboard's "Share" button.

Pinned here:
  * read access, not write: anyone who may view the customer's documents may share
    the quotation (owner/admin/accounts any; salesperson/telecaller if assigned)
  * GET returns a signed URL only for the CURRENT pdf (quotations.pdf_key); 404 while
    none exists — the dashboard polls through that state after POST
  * POST only enqueues — rendering runs headless Chromium (~1GB), which must stay in
    the worker, never the 1GB-capped API container
  * an unknown id is 404 before any access check; a deleted (expired) quotation is
    409 — it must not keep circulating with prices on it

Collaborators stubbed — no DB, no network, no Celery, no JWT.
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, quotations
from src.repositories import quotation_repo
from src.services import storage

CUSTOMER = str(uuid4())
QUOTE_ID = uuid4()


@pytest.fixture
def wired(monkeypatch):
    state = {
        "quote": {"customer_id": CUSTOMER, "quote_no": "QTN-0042", "pdf_key": "quotes/q.pdf",
                  "status": "sent"},
        "role": "salesperson",
        "may_read": True,
        "enqueued": [],
        "enqueue_error": None,
        "sign_error": None,
        "signed": [],
    }

    @asynccontextmanager
    async def _session():
        yield object()

    async def _resolve_caller(session, auth_uid):
        return authz.Caller(salesperson_id=str(uuid4()), role=state["role"])

    async def _assert_can_read_customer(session, caller, customer_id):
        assert customer_id == CUSTOMER
        if not state["may_read"]:
            raise HTTPException(status_code=403, detail="Not authorized")

    async def _get_pdf_info(session, quotation_id):
        return state["quote"]

    async def _signed_url_async(bucket, key, expires_in=3600):
        if state["sign_error"]:
            raise state["sign_error"]
        state["signed"].append((bucket, key, expires_in))
        return f"https://storage.example/{key}?token=t"

    def _enqueue(quotation_id):
        if state["enqueue_error"]:
            raise state["enqueue_error"]
        state["enqueued"].append(quotation_id)

    monkeypatch.setattr(quotations, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve_caller)
    monkeypatch.setattr(authz, "assert_can_read_customer", _assert_can_read_customer)
    monkeypatch.setattr(quotation_repo, "get_pdf_info", _get_pdf_info)
    monkeypatch.setattr(storage, "signed_url_async", _signed_url_async)
    monkeypatch.setattr(quotations, "_enqueue_pdf_render", _enqueue)
    return state


def _get():
    return asyncio.run(quotations.quotation_pdf_url(QUOTE_ID, caller_uid="uid"))


def _post():
    return asyncio.run(quotations.render_quotation_pdf(QUOTE_ID, caller_uid="uid"))


# ─── GET ──────────────────────────────────────────────────────────────────────

def test_get_returns_a_signed_url_for_the_current_pdf(wired):
    out = _get()

    assert out["url"].startswith("https://storage.example/quotes/q.pdf")
    assert out["quote_no"] == "QTN-0042"
    assert out["filename"] == "QTN-0042.pdf"
    [(_, key, expires_in)] = wired["signed"]
    assert key == "quotes/q.pdf"
    assert expires_in == quotations.get_settings().QUOTE_SHARE_URL_TTL_S
    assert out["expires_in"] == expires_in, "the UI states the link's lifetime from this"


def test_get_is_404_while_no_pdf_exists(wired):
    wired["quote"] = {**wired["quote"], "pdf_key": None}

    with pytest.raises(HTTPException) as exc:
        _get()
    assert exc.value.status_code == 404
    assert wired["signed"] == []


def test_get_unknown_quotation_is_404(wired):
    wired["quote"] = None

    with pytest.raises(HTTPException) as exc:
        _get()
    assert exc.value.status_code == 404


def test_get_refused_reader_gets_no_url(wired):
    wired["may_read"] = False

    with pytest.raises(HTTPException) as exc:
        _get()
    assert exc.value.status_code == 403
    assert wired["signed"] == []


def test_get_storage_failure_is_502(wired):
    wired["sign_error"] = storage.StorageError("down")

    with pytest.raises(HTTPException) as exc:
        _get()
    assert exc.value.status_code == 502


def test_get_deleted_quotation_is_409_and_signs_nothing(wired):
    wired["quote"] = {**wired["quote"], "status": "expired"}

    with pytest.raises(HTTPException) as exc:
        _get()
    assert exc.value.status_code == 409
    assert wired["signed"] == []


# ─── POST ─────────────────────────────────────────────────────────────────────

def test_post_enqueues_a_render(wired):
    out = _post()

    assert out["status"] == "queued"
    assert wired["enqueued"] == [str(QUOTE_ID)]


def test_post_refused_reader_enqueues_nothing(wired):
    wired["may_read"] = False

    with pytest.raises(HTTPException) as exc:
        _post()
    assert exc.value.status_code == 403
    assert wired["enqueued"] == []


def test_post_unknown_quotation_is_404_and_enqueues_nothing(wired):
    wired["quote"] = None

    with pytest.raises(HTTPException) as exc:
        _post()
    assert exc.value.status_code == 404
    assert wired["enqueued"] == []


def test_post_broker_failure_is_502(wired):
    wired["enqueue_error"] = RuntimeError("redis down")

    with pytest.raises(HTTPException) as exc:
        _post()
    assert exc.value.status_code == 502


def test_post_deleted_quotation_is_409_and_enqueues_nothing(wired):
    wired["quote"] = {**wired["quote"], "status": "expired"}

    with pytest.raises(HTTPException) as exc:
        _post()
    assert exc.value.status_code == 409
    assert wired["enqueued"] == []


def test_front_desk_may_share_any_quotation(wired):
    """0052: the front desk prepares and hands over quotations for any customer."""
    wired["role"] = "front_desk"
    wired["may_read"] = False   # not assigned to the customer — irrelevant for the desk

    assert _get()["url"]
