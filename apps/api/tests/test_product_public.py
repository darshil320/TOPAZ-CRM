"""GET /api/public/products/{code} — the customer side of a QR sticker.

The strict client requirement: a customer must NEVER receive price, GST, HSN, stock or
location — not on screen, not in page source, not by calling the API directly. These
tests pin each layer independently:

  * the SQL never reads a forbidden column (query-text check)
  * the response model cannot carry one (schema check)
  * even if the repository returned one by mistake, the HTTP body does not (end-to-end
    through the real app, with the repository stubbed to leak on purpose)
  * malformed / unknown / inactive codes are one uniform 404, and a malformed one never
    reaches the database

No DB, no network: the session and Storage are stubbed.
"""
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient
from src.api import public_products
from src.main import create_app
from src.repositories import product_repo
from src.services import storage

FORBIDDEN = ("base_price", "gst_rate", "hsn", "price", "gst", "stock", "location",
             "quantity", "stock_status", "qr_code_id", "id")

LEAKY_ROW = {
    "code": "7K3M9QXA",
    "name": "Royal Sofa",
    "category": "Sofa",
    "description": "Teak frame",
    "sizes": "3-seater",
    "dimensions": "84 x 36 x 32 in",
    "material": "Teak",
    "finish": "Walnut",
    "photo_keys": ["product/p1/m1.jpg", "product/p1/m2.jpg"],
    "thumb_keys": ["product/p1/m1_thumb.jpg", None],
    # A future bug that selected too much — none of this may reach the customer.
    "id": "60000000-0000-0000-0000-000000000001",
    "base_price": 42000,
    "gst_rate": 18,
    "hsn": "9401",
    "stock_status": "in_stock",
    "stock": [{"location": "Godown", "quantity": 3}],
}


@pytest.fixture
def wired(monkeypatch):
    state = {"row": dict(LEAKY_ROW), "repo_calls": [], "sign_fails": False}

    @asynccontextmanager
    async def _session():
        yield object()

    async def _get_public(session, code, *, max_photos):
        state["repo_calls"].append(code)
        return state["row"]

    async def _sign(bucket, keys, expires_in):
        if state["sign_fails"]:
            raise storage.StorageError("storage down")
        return {k: f"https://signed.example/{k}?token=t" for k in keys}

    monkeypatch.setattr(public_products, "get_api_session", _session)
    monkeypatch.setattr(product_repo, "get_public_by_code", _get_public)
    monkeypatch.setattr(storage, "signed_urls_async", _sign)
    return state


@pytest.fixture
def client():
    return TestClient(create_app(), raise_server_exceptions=False)


def _keys(obj) -> set[str]:
    if isinstance(obj, dict):
        return set(obj) | {k for v in obj.values() for k in _keys(v)}
    if isinstance(obj, list):
        return {k for v in obj for k in _keys(v)}
    return set()


# ─── Layer 1: the SQL ───────────────────────────────────────────────────────

@pytest.mark.parametrize("token", ["base_price", "gst_rate", "hsn", "product_stock",
                                   "stock_locations", "stock_status", "location"])
def test_public_sql_never_reads_a_forbidden_column(token):
    assert token not in product_repo.PUBLIC_PRODUCT_SQL


def test_public_sql_only_serves_active_products():
    assert "p.active = true" in product_repo.PUBLIC_PRODUCT_SQL


# ─── Layer 2: the response model ────────────────────────────────────────────

def test_response_model_is_exactly_the_allowlist():
    fields = set(public_products.PublicProduct.model_fields)
    assert fields == {"code", "photos", *product_repo.PUBLIC_COLUMNS}
    assert not fields & set(FORBIDDEN)


def test_response_model_refuses_extra_fields():
    with pytest.raises(ValueError):
        public_products.PublicProduct(code="7K3M9QXA", name="X", base_price=1)


# ─── Layer 3: end to end through the real app ───────────────────────────────

def test_http_body_never_carries_a_forbidden_field_even_if_the_repo_leaks(wired, client):
    resp = client.get("/api/public/products/7K3M9QXA")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert not _keys(body) & set(FORBIDDEN)
    assert "42000" not in resp.text and "9401" not in resp.text and "Godown" not in resp.text
    assert body["name"] == "Royal Sofa" and body["dimensions"] == "84 x 36 x 32 in"


def test_needs_no_dashboard_key(wired, client):
    assert client.get("/api/public/products/7K3M9QXA").status_code == 200


def test_photos_come_signed_primary_first_with_thumbnails(wired, client):
    photos = client.get("/api/public/products/7K3M9QXA").json()["photos"]
    assert [p["url"].split("?")[0] for p in photos] == [
        "https://signed.example/product/p1/m1.jpg",
        "https://signed.example/product/p1/m2.jpg",
    ]
    assert photos[0]["thumb_url"].startswith("https://signed.example/product/p1/m1_thumb.jpg")
    assert photos[1]["thumb_url"] is None


def test_storage_outage_costs_the_photos_not_the_page(wired, client):
    wired["sign_fails"] = True
    resp = client.get("/api/public/products/7K3M9QXA")
    assert resp.status_code == 200 and resp.json()["photos"] == []


def test_response_is_never_cached(wired, client):
    resp = client.get("/api/public/products/7K3M9QXA")
    assert resp.headers["cache-control"] == "no-store"
    assert resp.headers["x-robots-tag"] == "noindex"


def test_code_is_canonicalised_before_the_lookup(wired, client):
    client.get("/api/public/products/7k3m-9qxa")
    assert wired["repo_calls"] == ["7K3M9QXA"]


@pytest.mark.parametrize("code", ["nope", "7K3M9QXU", "' or 1=1 --", "A" * 40])
def test_malformed_code_is_404_and_never_queries(wired, client, code):
    resp = client.get(f"/api/public/products/{code}")
    assert resp.status_code == 404
    assert wired["repo_calls"] == []


def test_unknown_or_inactive_code_is_the_same_404(wired, client):
    wired["row"] = None
    resp = client.get("/api/public/products/7K3M9QXA")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Product not found"}
