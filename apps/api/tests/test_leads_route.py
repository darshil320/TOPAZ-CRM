"""POST /leads and PATCH /leads/{id} — who may capture a lead, and who may edit one.

The leads router was the only write router with no identity dependency: it took the
shared dashboard API key and nothing else, so `PATCH /leads/{id}` accepted an edit from
anyone holding that key, and `create_lead` stamped `created_by=None` on every row.

RLS does not run on the service-role connection the API uses, so 0047's `leads_update`
policy is documentation until this route enforces the same predicate. These tests are
that predicate, pinned:

  * create must record the calling salesperson, or creator-scoped edit is unenforceable
  * a non-creator's PATCH must not merely fail — it must not write and must not commit
  * owner passes; `admin` does NOT (the product decision is owner-only, and `is_admin`
    covers {"owner", "admin"} — a refactor to it would silently widen the API)
  * status/convert stay open to any salesperson, deliberately
  * a follow-up due date is a plain editable field (creator+owner gated, same as any
    other field), and moving a lead to a terminal status (lost/converted) clears it —
    see 0050

Collaborators stubbed — no DB, no network, no JWT.
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api import authz, leads
from src.repositories import enrollment_repo, lead_repo

CREATOR = str(uuid4())
OTHER = str(uuid4())


@pytest.fixture
def wired(monkeypatch):
    state = {
        # The lead PATCH/status/convert will find. None ⇒ 404.
        "lead": {
            "id": str(uuid4()),
            "status": "qualified",
            "created_by": CREATOR,
            "assigned_to": OTHER,
            "phone": "+919426529230",
            "name": "Hemant",
            "requirement": "7-seater sofa",
            "followup_due_on": None,
            "followup_notified_at": None,
        },
        "caller": authz.Caller(salesperson_id=CREATOR, role="salesperson"),
        "create_calls": [],
        "update_calls": [],
        "set_status_calls": [],
        "convert_calls": [],
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

    async def _create_lead(session, *, created_by, **fields):
        state["create_calls"].append({"created_by": created_by, **fields})
        return {"id": str(uuid4()), "created_by": created_by, **fields}

    async def _update_lead(session, lead_id, **fields):
        state["update_calls"].append({"id": str(lead_id), **fields})
        return {**state["lead"], **fields}

    async def _set_status(session, lead_id, *, status, lost_reason=None, clear_followup=False):
        state["set_status_calls"].append(
            {"status": status, "lost_reason": lost_reason, "clear_followup": clear_followup}
        )
        extra = (
            {"followup_due_on": None, "followup_notified_at": None} if clear_followup else {}
        )
        return {**state["lead"], "status": status, "lost_reason": lost_reason, **extra}

    async def _find_customer_by_phone(session, phone):
        return None

    async def _mark_converted(session, lead_id, *, customer_id):
        state["convert_calls"].append({"customer_id": str(customer_id)})
        return {
            **state["lead"], "status": "converted", "converted_customer_id": str(customer_id),
            "followup_due_on": None, "followup_notified_at": None,
        }

    async def _enroll_customer(session, **kwargs):
        return (None, uuid4())

    monkeypatch.setattr(leads, "get_api_session", _session)
    monkeypatch.setattr(authz, "resolve_caller", _resolve_caller)
    monkeypatch.setattr(lead_repo, "get_lead", _get_lead)
    monkeypatch.setattr(lead_repo, "create_lead", _create_lead)
    monkeypatch.setattr(lead_repo, "update_lead", _update_lead)
    monkeypatch.setattr(lead_repo, "set_status", _set_status)
    monkeypatch.setattr(lead_repo, "find_customer_by_phone", _find_customer_by_phone)
    monkeypatch.setattr(lead_repo, "mark_converted", _mark_converted)
    monkeypatch.setattr(enrollment_repo, "enroll_customer", _enroll_customer)
    return state


def _as(state, *, role="salesperson", salesperson_id=CREATOR):
    state["caller"] = authz.Caller(salesperson_id=salesperson_id, role=role)


def _create(**over):
    body = {"phone": "+919426529230", "name": "Hemant", "source": "walk_in"}
    body.update(over)
    return asyncio.run(leads.create_lead(leads.LeadCreate(**body), auth_uid="uid"))


def _patch(lead_id=None, **fields):
    body = leads.LeadUpdate(**(fields or {"name": "Hemant Patel"}))
    return asyncio.run(leads.update_lead(lead_id or uuid4(), body, auth_uid="uid"))


def _status(to="contacted", reason=None):
    body = leads.StatusChange(status=to, lost_reason=reason)
    return asyncio.run(leads.change_status(uuid4(), body, auth_uid="uid"))


def _convert():
    return asyncio.run(leads.convert_lead(uuid4(), auth_uid="uid"))


# ─── create records the creator ──────────────────────────────────────────────

def test_create_stamps_the_calling_salesperson_as_creator(wired):
    """Without this every row keeps created_by NULL and creator-scoped edit is a no-op."""
    _as(wired, salesperson_id=OTHER)

    out = _create()

    assert wired["create_calls"][0]["created_by"] == OTHER
    assert out["created_by"] == OTHER
    assert wired["committed"]


def test_created_by_is_never_taken_from_the_request_body():
    """Identity comes from the verified token only (security-review HIGH-3/4).

    Asserted on the schema, not on a runtime rejection: Pydantic v2 defaults to
    extra="ignore", so a created_by key in the body is silently dropped rather than
    raising. The guarantee that matters is that no such field exists to bind to.
    """
    assert "created_by" not in leads.LeadCreate.model_fields
    assert "created_by" not in leads.LeadUpdate.model_fields


# ─── who may edit ────────────────────────────────────────────────────────────

def test_creator_may_edit_their_own_lead(wired):
    _as(wired, salesperson_id=CREATOR)

    out = _patch(name="Hemant Patel")

    assert out["name"] == "Hemant Patel"
    assert len(wired["update_calls"]) == 1
    assert wired["update_calls"][0]["name"] == "Hemant Patel"
    assert wired["committed"]


def test_owner_may_edit_anyones_lead(wired):
    _as(wired, role="owner", salesperson_id=OTHER)

    _patch(name="Corrected")

    assert len(wired["update_calls"]) == 1


def test_non_creator_salesperson_is_refused(wired):
    _as(wired, salesperson_id=OTHER)

    with pytest.raises(HTTPException) as exc:
        _patch(phone="+919999999999")
    assert exc.value.status_code == 403
    assert wired["update_calls"] == [], "a refused edit must not reach the repository"
    assert not wired["committed"], "a refused edit must not commit"


def test_assignee_who_is_not_the_creator_is_refused(wired):
    """The chosen scope is creator + owner. The lead's assigned_to is OTHER, and that
    alone must not grant edit rights — 0046's broader policy is narrowed by 0047."""
    _as(wired, salesperson_id=OTHER)
    assert wired["lead"]["assigned_to"] == OTHER

    with pytest.raises(HTTPException) as exc:
        _patch(name="Nope")
    assert exc.value.status_code == 403
    assert wired["update_calls"] == []


def test_admin_is_not_an_owner_for_lead_edits(wired):
    """Caller.is_admin covers {"owner", "admin"}; this gate is owner-only. A later
    "cleanup" to is_admin must break this test rather than widen the API past RLS."""
    _as(wired, role="admin", salesperson_id=OTHER)

    with pytest.raises(HTTPException) as exc:
        _patch(name="Nope")
    assert exc.value.status_code == 403
    assert wired["update_calls"] == []


def test_a_lead_with_no_recorded_creator_is_owner_only(wired):
    """Rows the 0047 backfill could not attribute (no creator, no assignee) stay locked
    to the owner — the safe default, never open-to-all."""
    wired["lead"] = {**wired["lead"], "created_by": None}
    _as(wired, salesperson_id=CREATOR)

    with pytest.raises(HTTPException) as exc:
        _patch(name="Nope")
    assert exc.value.status_code == 403

    _as(wired, role="owner", salesperson_id=OTHER)
    _patch(name="Fine")
    assert len(wired["update_calls"]) == 1


def test_missing_lead_is_404(wired):
    wired["lead"] = None

    with pytest.raises(HTTPException) as exc:
        _patch()
    assert exc.value.status_code == 404


def test_404_wins_over_403_for_a_non_creator(wired):
    """Answering 403 for an id that does not exist tells the caller a lead is there."""
    wired["lead"] = None
    _as(wired, salesperson_id=OTHER)

    with pytest.raises(HTTPException) as exc:
        _patch()
    assert exc.value.status_code == 404


# ─── status and convert stay open ────────────────────────────────────────────

def test_status_is_not_creator_gated(wired):
    """0046: "the person who picks up the phone is rarely the one who took the original
    enquiry". A lead only its author can progress dies when its author is off."""
    wired["lead"] = {**wired["lead"], "status": "new"}
    _as(wired, salesperson_id=OTHER)

    out = _status("contacted")

    assert out["status"] == "contacted"
    assert wired["set_status_calls"] == [
        {"status": "contacted", "lost_reason": None, "clear_followup": False}
    ]


def test_convert_is_not_creator_gated(wired):
    _as(wired, salesperson_id=OTHER)

    out = _convert()

    assert out["lead"]["status"] == "converted"
    assert len(wired["convert_calls"]) == 1


# ─── follow-up due date ───────────────────────────────────────────────────────

def test_creator_may_set_followup_due_on(wired):
    from datetime import date

    _as(wired, salesperson_id=CREATOR)

    out = _patch(followup_due_on="2026-10-05")

    # LeadUpdate parses the ISO string into a real date — a Pydantic guarantee,
    # not something this route or repo mock needs to special-case.
    assert wired["update_calls"][0]["followup_due_on"] == date(2026, 10, 5)
    assert out["followup_due_on"] == date(2026, 10, 5)


def test_creator_may_clear_followup_due_on(wired):
    _as(wired, salesperson_id=CREATOR)

    _patch(followup_due_on=None)

    # exclude_unset means an explicit null still reaches update_lead as a key.
    assert "followup_due_on" in wired["update_calls"][0]
    assert wired["update_calls"][0]["followup_due_on"] is None


def test_non_creator_cannot_set_followup_due_on(wired):
    """No new bypass: setting a due date is gated exactly like any other field."""
    _as(wired, salesperson_id=OTHER)

    with pytest.raises(HTTPException) as exc:
        _patch(followup_due_on="2026-10-05")
    assert exc.value.status_code == 403
    assert wired["update_calls"] == []


def test_marking_a_lead_lost_clears_the_followup(wired):
    wired["lead"] = {**wired["lead"], "status": "new", "followup_due_on": "2026-10-01"}
    _as(wired, salesperson_id=OTHER)

    out = _status("lost", reason="Went with a competitor")

    assert wired["set_status_calls"][0]["clear_followup"] is True
    assert out["followup_due_on"] is None
    assert out["followup_notified_at"] is None


def test_other_status_transitions_do_not_clear_the_followup(wired):
    wired["lead"] = {**wired["lead"], "status": "new", "followup_due_on": "2026-10-01"}
    _as(wired, salesperson_id=OTHER)

    _status("contacted")

    assert wired["set_status_calls"][0]["clear_followup"] is False


def test_convert_clears_the_followup(wired):
    wired["lead"] = {**wired["lead"], "followup_due_on": "2026-10-01"}
    _as(wired, salesperson_id=OTHER)

    out = _convert()

    assert out["lead"]["followup_due_on"] is None
    assert out["lead"]["followup_notified_at"] is None
