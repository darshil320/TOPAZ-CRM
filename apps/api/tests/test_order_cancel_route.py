"""PATCH /orders/{id}/status and GET /orders/{id}/cancellation-preview — the cancel route.

The cancel path diverges from every other transition: it swaps `get_status` for
`cancellation_state` (which carries the status AND the blockers, so it is not an extra
round-trip), refuses on physical blockers, and stands production down in the same
transaction. Each of those is a place the route could go wrong quietly:

  * a blocker that does not block
  * a blocker that blocks but flips the status anyway
  * a stand-down that runs on a NON-cancel transition
  * a stand-down that runs after a lost race

Collaborators stubbed — no DB, no network.
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api import orders
from src.repositories import order_repo


@pytest.fixture
def wired(monkeypatch):
    state = {
        "cancellation_state": {},
        "status": "confirmed",
        "set_status_ok": True,
        "set_status_calls": [],
        "stand_down_calls": [],
        "committed": False,
    }

    class _S:
        async def commit(self):
            state["committed"] = True

    @asynccontextmanager
    async def _session():
        yield _S()

    async def _authorize_order(session, caller_uid, order_id):
        return None

    async def _cancellation_state(session, order_id):
        return state["cancellation_state"]

    async def _get_status(session, order_id):
        return state["status"]

    async def _set_status(session, order_id, *, from_status, to_status, reason=None):
        state["set_status_calls"].append(
            {"from": from_status, "to": to_status, "reason": reason}
        )
        return state["set_status_ok"]

    async def _cancel_open_production(session, order_id):
        state["stand_down_calls"].append(str(order_id))
        return {"legs_cancelled": 2, "assignments_closed": 2, "stage_plans_skipped": 3}

    monkeypatch.setattr(orders, "get_api_session", _session)
    monkeypatch.setattr(orders, "_authorize_order", _authorize_order)
    monkeypatch.setattr(order_repo, "cancellation_state", _cancellation_state)
    monkeypatch.setattr(order_repo, "get_status", _get_status)
    monkeypatch.setattr(order_repo, "set_status", _set_status)
    monkeypatch.setattr(order_repo, "cancel_open_production", _cancel_open_production)
    return state


def _clean(status="in_production", **over):
    base = {
        "status": status,
        "grand_total": 10000,
        "in_transit_items": 0,
        "open_delivery_items": 0,
        "delivered_items": 0,
        "total_items": 2,
        "paid": 0,
    }
    base.update(over)
    return base


def _patch(to="cancelled", reason="Customer withdrew", order_id=None):
    req = orders.StatusPatch(status=to, reason=reason)
    return asyncio.run(orders.patch_status(order_id or uuid4(), req, caller_uid="uid"))


def _preview(order_id=None):
    return asyncio.run(orders.cancellation_preview(order_id or uuid4(), caller_uid="uid"))


# ─── the happy path ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("from_status", ["confirmed", "in_production", "ready"])
def test_cancel_succeeds_and_stands_production_down(wired, from_status):
    wired["cancellation_state"] = _clean(from_status)

    out = _patch()

    assert out["status"] == "cancelled"
    assert wired["set_status_calls"] == [
        {"from": from_status, "to": "cancelled", "reason": "Customer withdrew"}
    ]
    assert len(wired["stand_down_calls"]) == 1
    assert out["legs_cancelled"] == 2
    assert out["stage_plans_skipped"] == 3
    assert wired["committed"]


def test_refund_owed_is_reported_back(wired):
    wired["cancellation_state"] = _clean(paid=7500)

    out = _patch()

    assert out["refund_due"] == "7500"


def test_no_refund_reads_as_zero_not_absent(wired):
    """The dashboard branches on this number; `undefined` would read as falsy-but-unknown."""
    wired["cancellation_state"] = _clean(paid=0)

    assert _patch()["refund_due"] == "0"


# ─── blockers ────────────────────────────────────────────────────────────────

def test_in_transit_items_block_the_cancel(wired):
    wired["cancellation_state"] = _clean(in_transit_items=2)

    with pytest.raises(HTTPException) as exc:
        _patch()
    assert exc.value.status_code == 409
    assert "in transit" in exc.value.detail
    assert "receive or cancel those consignments first" in exc.value.detail
    assert wired["set_status_calls"] == [], "status must not move when blocked"
    assert wired["stand_down_calls"] == []


def test_open_delivery_blocks_the_cancel(wired):
    wired["cancellation_state"] = _clean(open_delivery_items=1)

    with pytest.raises(HTTPException) as exc:
        _patch()
    assert exc.value.status_code == 409
    assert "delivery that has not completed" in exc.value.detail
    assert wired["set_status_calls"] == []


def test_transit_is_reported_before_delivery_when_both_apply(wired):
    """Deterministic message: two blockers must not produce a coin-flip error."""
    wired["cancellation_state"] = _clean(in_transit_items=1, open_delivery_items=1)

    with pytest.raises(HTTPException) as exc:
        _patch()
    assert "in transit" in exc.value.detail


# ─── the map still governs ───────────────────────────────────────────────────

@pytest.mark.parametrize("from_status", ["delivered", "installed", "closed", "cancelled"])
def test_cancel_refused_once_the_goods_have_gone(wired, from_status):
    wired["cancellation_state"] = _clean(from_status)

    with pytest.raises(HTTPException) as exc:
        _patch()
    assert exc.value.status_code == 409
    assert "Illegal transition" in exc.value.detail
    assert wired["stand_down_calls"] == []


def test_cancel_without_a_reason_is_422(wired):
    wired["cancellation_state"] = _clean()

    with pytest.raises(HTTPException) as exc:
        _patch(reason="   ")
    assert exc.value.status_code == 422
    assert wired["set_status_calls"] == []


def test_missing_order_is_404(wired):
    wired["cancellation_state"] = {}

    with pytest.raises(HTTPException) as exc:
        _patch()
    assert exc.value.status_code == 404


def test_lost_race_does_not_stand_production_down(wired):
    """If the status moved under us the cancel did NOT happen, so releasing the
    workshops would be standing down an order somebody else is still building."""
    wired["cancellation_state"] = _clean()
    wired["set_status_ok"] = False

    with pytest.raises(HTTPException) as exc:
        _patch()
    assert exc.value.status_code == 409
    assert wired["stand_down_calls"] == []


# ─── non-cancel transitions are untouched ────────────────────────────────────

def test_forward_transition_does_not_touch_production_or_read_cancel_state(wired):
    wired["status"] = "confirmed"
    # Deliberately poisoned: a forward transition must not consult it at all.
    wired["cancellation_state"] = _clean("ready", in_transit_items=99)

    out = _patch(to="in_production", reason=None)

    assert out == {"order_id": out["order_id"], "status": "in_production"}
    assert "refund_due" not in out
    assert wired["stand_down_calls"] == []
    assert wired["set_status_calls"] == [
        {"from": "confirmed", "to": "in_production", "reason": None}
    ]


# ─── the preview ─────────────────────────────────────────────────────────────

def test_preview_reports_cancellable_and_the_refund(wired):
    wired["cancellation_state"] = _clean("in_production", paid=2500, delivered_items=1)

    out = _preview()

    assert out["cancellable"] is True
    assert out["status_allows_cancel"] is True
    assert out["blockers"] == []
    assert out["refund_due"] == "2500"
    assert out["delivered_items"] == 1
    assert out["total_items"] == 2


def test_preview_reports_blockers_without_raising(wired):
    """The dialog needs the reason IN the body — a 409 would just show an error toast
    and tell the operator nothing about what to fix."""
    wired["cancellation_state"] = _clean(in_transit_items=3)

    out = _preview()

    assert out["cancellable"] is False
    assert out["status_allows_cancel"] is True
    assert len(out["blockers"]) == 1
    assert "in transit" in out["blockers"][0]


def test_preview_distinguishes_wrong_status_from_a_blocker(wired):
    """A delivered order is not blocked by anything physical — it is simply past the
    point where cancelling is the right verb, and the dialog words that differently."""
    wired["cancellation_state"] = _clean("delivered")

    out = _preview()

    assert out["cancellable"] is False
    assert out["status_allows_cancel"] is False
    assert out["blockers"] == []


def test_preview_on_a_missing_order_is_404(wired):
    wired["cancellation_state"] = {}

    with pytest.raises(HTTPException) as exc:
        _preview()
    assert exc.value.status_code == 404
