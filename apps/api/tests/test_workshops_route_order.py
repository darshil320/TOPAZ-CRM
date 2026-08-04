"""`GET /api/workshops/staff` reaches the batched-roster route, not the UUID one.

The batched roster is a LITERAL path added to a router that already had a
parameterised `/{workshop_id}/staff`. If the two ever collide, the failure is quiet
and confusing: every call 422s on "staff" not being a UUID and the admin tab shows an
error banner where the rosters should be. So it is asserted rather than assumed.

Routed through the real app with a valid dashboard key and NO Authorization header, so
the request gets as far as the route's own dependencies and stops there. Which
parameter the 422 names is the discriminator:

  * reached the batch route  → the missing `authorization` header
  * swallowed by the UUID route → `workshop_id`

No DB and no network: the request never gets past dependency validation.
"""
from fastapi.testclient import TestClient

from src.config import get_settings
from src.main import create_app

KEY = "route-order-test-key-0123456789abcdef"
GOOD_UUID = "0f9c1c26-1f6f-4c2e-9a3a-2b7f0f8c1111"


def _client(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "DASHBOARD_API_KEY", KEY)
    return TestClient(create_app(), raise_server_exceptions=False)


def _missing_params(resp) -> set[str]:
    """The field names a 422 complains about, however deep they are in `loc`.

    Lower-cased: the header alias is declared as `Authorization` but path/query params
    are lower-case, and this test cares about WHICH field, not its capitalisation.
    """
    detail = resp.json().get("detail")
    assert isinstance(detail, list), f"expected a validation error body, got {resp.json()}"
    return {str(part).lower() for item in detail for part in item.get("loc", [])}


def test_batch_route_is_reached_and_is_not_the_uuid_route(monkeypatch):
    resp = _client(monkeypatch).get("/api/workshops/staff", headers={"API-Key": KEY})

    assert resp.status_code == 422, resp.text
    params = _missing_params(resp)
    assert "authorization" in params, f"did not reach the batch route: {resp.json()}"
    assert "workshop_id" not in params, (
        "GET /api/workshops/staff was matched by /{workshop_id}/staff — the literal "
        "route must be declared first"
    )


def test_per_workshop_route_still_works(monkeypatch):
    resp = _client(monkeypatch).get(
        f"/api/workshops/{GOOD_UUID}/staff", headers={"API-Key": KEY}
    )
    assert resp.status_code == 422, resp.text
    # Same stopping point — a valid UUID leaves only the missing Authorization header.
    assert "authorization" in _missing_params(resp)


def test_a_genuinely_bad_workshop_id_is_still_rejected_as_one(monkeypatch):
    """Proves the discriminator above actually discriminates: a non-UUID segment in
    the parameterised position really does name `workshop_id`."""
    resp = _client(monkeypatch).get("/api/workshops/not-a-uuid/staff", headers={"API-Key": KEY})
    assert resp.status_code == 422, resp.text
    assert "workshop_id" in _missing_params(resp)


def test_the_other_literal_sibling_still_resolves(monkeypatch):
    resp = _client(monkeypatch).get("/api/workshops/mine", headers={"API-Key": KEY})
    assert resp.status_code == 422, resp.text
    params = _missing_params(resp)
    assert "authorization" in params
    assert "workshop_id" not in params
