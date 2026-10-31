"""POST/PUT /products, GET /products/{id}/qr, POST /products/stickers — who may manage
the catalog, and what one save writes.

RLS does not run on the service-role connection, so these route gates ARE the write
boundary for products + stock (product_stock has no browser write grant at all):

  * create/edit/print: owner, super_admin, admin — nobody else, including salesperson
  * a save writes the product AND its stock in one transaction, and audits the delta
  * unknown locations and duplicate location lines are refused before any write
  * the QR preview is open to every staff role; the sticker PDF caps its size, is
    rendered in the worker (never the api container), and the worker is handed only
    name + code

Collaborators stubbed — no DB, no network, no browser.
"""
import asyncio
from contextlib import asynccontextmanager
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from src.api import authz, products
from src.repositories import audit_repo, product_repo
from src.services import storage

GODOWN = str(uuid4())
BHATAR = str(uuid4())
PRODUCT_ID = uuid4()


@pytest.fixture
def wired(monkeypatch):
    state = {
        "caller": authz.Caller(salesperson_id=str(uuid4()), role="admin"),
        "existing": {"id": PRODUCT_ID, "qr_code": "7K3M9QXA", "active": True, "name": "Old",
                     "category": None, "description": None, "sizes": None, "dimensions": None,
                     "material": None, "finish": None, "hsn": "9403",
                     "gst_rate": Decimal("18.00"), "base_price": Decimal("40000.00"),
                     "unit": "nos", "stock_status": "in_stock"},
        "stock_before": {GODOWN: 2},
        "created": [], "updated": [], "stock": [], "audits": [], "committed": False,
    }

    class _S:
        async def commit(self):
            state["committed"] = True

    @asynccontextmanager
    async def _session():
        yield _S()

    async def _resolve(session, uid):
        return state["caller"]

    async def _create(session, fields):
        state["created"].append(fields)
        return {"id": PRODUCT_ID, "qr_code": "7K3M9QXA"}

    async def _update(session, pid, fields):
        state["updated"].append(fields)

    async def _get(session, pid):
        return state["existing"]

    async def _locations(session):
        return {GODOWN, BHATAR}

    async def _get_stock(session, pid):
        return state["stock_before"]

    async def _upsert(session, pid, quantities, *, actor_id):
        state["stock"].append(quantities)

    async def _audit(session, **kw):
        state["audits"].append(kw)

    async def _lock(session, pid):
        state.setdefault("locked", []).append(pid)

    monkeypatch.setattr(products, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve)
    monkeypatch.setattr(product_repo, "create_product", _create)
    monkeypatch.setattr(product_repo, "update_product", _update)
    monkeypatch.setattr(product_repo, "get_product", _get)
    monkeypatch.setattr(product_repo, "active_location_ids", _locations)
    monkeypatch.setattr(product_repo, "get_stock", _get_stock)
    monkeypatch.setattr(product_repo, "upsert_stock", _upsert)
    monkeypatch.setattr(audit_repo, "record", _audit)
    monkeypatch.setattr(product_repo, "lock_product", _lock)
    return state


def _body(**over):
    body = {"name": "  Royal Sofa ", "base_price": "42000", "gst_rate": "18",
            "stock": [{"location_id": GODOWN, "quantity": 3}]}
    body.update(over)
    return products.ProductSave(**body)


def _create(state, **over):
    return asyncio.run(products.create_product(_body(**over), uid="uid"))


def _update(state, **over):
    return asyncio.run(products.update_product(PRODUCT_ID, _body(**over), uid="uid"))


@pytest.mark.parametrize("role", ["owner", "super_admin", "admin"])
def test_managers_create_a_product_with_stock(wired, role):
    wired["caller"] = authz.Caller(salesperson_id=wired["caller"].salesperson_id, role=role)
    out = _create(wired)
    assert out["qr_code"] == "7K3M9QXA" and out["url"].endswith("/p/7K3M9QXA")
    assert wired["created"][0]["name"] == "Royal Sofa"
    assert wired["stock"] == [{GODOWN: 3}]
    assert wired["committed"]


@pytest.mark.parametrize("role", ["salesperson", "front_desk", "telecaller", "accounts",
                                  "workshop_manager", "delivery"])
def test_everyone_else_is_refused_and_nothing_is_written(wired, role):
    wired["caller"] = authz.Caller(salesperson_id=str(uuid4()), role=role)
    with pytest.raises(HTTPException) as exc:
        _create(wired)
    assert exc.value.status_code == 403
    assert wired["created"] == [] and wired["stock"] == [] and not wired["committed"]


def test_create_audits_the_opening_stock(wired):
    _create(wired)
    audit = wired["audits"][0]
    assert audit["action"] == "product_created"
    assert audit["payload"]["stock"] == {GODOWN: [0, 3]}


def test_unknown_location_is_refused_before_any_write(wired):
    with pytest.raises(HTTPException) as exc:
        _create(wired, stock=[{"location_id": str(uuid4()), "quantity": 1}])
    assert exc.value.status_code == 422
    assert wired["created"] == []


def test_a_location_twice_is_a_validation_error():
    with pytest.raises(ValidationError, match="only once"):
        _body(stock=[{"location_id": GODOWN, "quantity": 1}, {"location_id": GODOWN, "quantity": 2}])


@pytest.mark.parametrize("over", [
    {"name": "   "}, {"base_price": "-1"}, {"gst_rate": "100"}, {"hsn": "94O3"},
    {"stock_status": "sold"}, {"stock": [{"location_id": GODOWN, "quantity": -1}]},
    {"description": "x" * 4001},
])
def test_bad_input_is_refused_at_the_boundary(over):
    with pytest.raises(ValidationError):
        _body(**over)


def test_update_audits_only_what_changed(wired):
    _update(wired, stock=[{"location_id": GODOWN, "quantity": 2},
                          {"location_id": BHATAR, "quantity": 1}])
    audit = wired["audits"][0]
    assert audit["action"] == "product_updated"
    assert set(audit["payload"]["fields"]) == {"name", "base_price"}   # gst 18 == 18.00
    assert audit["payload"]["stock"] == {BHATAR: [0, 1]}


def test_update_of_a_missing_product_is_404(wired):
    wired["existing"] = None
    with pytest.raises(HTTPException) as exc:
        _update(wired)
    assert exc.value.status_code == 404
    assert wired["updated"] == []


def test_update_keeps_the_qr_code(wired):
    assert _update(wired)["qr_code"] == "7K3M9QXA"


def test_sticker_request_is_capped(wired):
    body = products.StickerRequest(product_ids=[uuid4() for _ in range(200)], copies=2)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(products.queue_sticker_pdf(body, uid="uid"))
    assert exc.value.status_code == 422


def test_sticker_request_validates_size_and_layout():
    with pytest.raises(ValidationError):
        products.StickerRequest(product_ids=[uuid4()], size="huge")
    with pytest.raises(ValidationError):
        products.StickerRequest(product_ids=[uuid4()], layout="fax")


def test_sticker_job_is_queued_with_only_name_and_code(wired, monkeypatch):
    queued = []

    async def _rows(session, ids):
        return [{"id": PRODUCT_ID, "name": "Royal Sofa", "qr_code": "7K3M9QXA",
                 "base_price": Decimal(42000)}]

    monkeypatch.setattr(product_repo, "sticker_rows", _rows)
    monkeypatch.setattr(products, "_enqueue_sticker_render",
                        lambda job_id, rows, body, base: queued.append((job_id, rows, body.size, base)))
    out = asyncio.run(products.queue_sticker_pdf(
        products.StickerRequest(product_ids=[PRODUCT_ID], size="medium", copies=3), uid="uid"))
    assert out["count"] == 3
    job_id, rows, size, base = queued[0]
    assert job_id == out["job_id"] and size == "medium" and base.endswith("/p")
    assert rows == [{"name": "Royal Sofa", "qr_code": "7K3M9QXA"}]


def test_sticker_job_refused_to_non_managers(wired, monkeypatch):
    wired["caller"] = authz.Caller(salesperson_id=str(uuid4()), role="salesperson")
    monkeypatch.setattr(products, "_enqueue_sticker_render", lambda *a: pytest.fail("queued"))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(products.queue_sticker_pdf(products.StickerRequest(product_ids=[PRODUCT_ID]), uid="uid"))
    assert exc.value.status_code == 403


def test_sticker_url_is_404_until_the_worker_stored_it(wired, monkeypatch):
    sizes = {"value": None}

    async def _size(bucket, key):
        assert key.startswith("stickers/") and key.endswith(".pdf")
        return sizes["value"]

    async def _sign(bucket, key, expires_in):
        return f"https://signed.example/{key}"

    monkeypatch.setattr(storage, "object_size_async", _size)
    monkeypatch.setattr(storage, "signed_url_async", _sign)
    job = uuid4()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(products.sticker_pdf_url(job, uid="uid"))
    assert exc.value.status_code == 404

    sizes["value"] = 1234
    out = asyncio.run(products.sticker_pdf_url(job, uid="uid"))
    assert out["url"] == f"https://signed.example/stickers/{job}.pdf"


def test_a_stale_stock_form_is_refused_and_writes_nothing(wired):
    # Loaded Godown=1, but someone else has since set it to 2 (stock_before).
    with pytest.raises(HTTPException) as exc:
        _update(wired, stock_loaded=[{"location_id": GODOWN, "quantity": 1}])
    assert exc.value.status_code == 409
    assert wired["updated"] == [] and wired["stock"] == [] and not wired["committed"]


def test_a_current_stock_form_saves_under_the_product_lock(wired):
    _update(wired, stock_loaded=[{"location_id": GODOWN, "quantity": 2},
                                 {"location_id": BHATAR, "quantity": 0}])
    assert wired["locked"] == [PRODUCT_ID]
    assert wired["stock"] == [{GODOWN: 3}]


def test_stale_locations_treats_missing_rows_as_zero():
    assert product_repo.stale_locations({"a": 2}, {"a": 2, "b": 0}) == []
    assert product_repo.stale_locations({"a": 2}, {"a": 1, "b": 0}) == ["a"]
