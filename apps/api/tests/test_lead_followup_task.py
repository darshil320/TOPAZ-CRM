"""Daily beat task: scan overdue lead follow-ups, claim, create a notification.

No WhatsApp/side-channel send (explicit user ask) — simpler than
stage_reminders.py: scan, claim, insert, commit, done. Monkeypatched
repo/session — no DB, no network, no Celery broker.
"""
import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest

from src.repositories import lead_followup_repo
from src.tasks import lead_followup_notify as task

ASSIGNEE = str(uuid4())
CREATOR = str(uuid4())


@pytest.fixture
def wired(monkeypatch):
    state = {
        "due": [],
        "claim_results": {},  # lead_id -> bool
        "create_calls": [],
        "committed": False,
        "rolled_back": False,
    }

    class _S:
        async def commit(self):
            state["committed"] = True

        async def rollback(self):
            state["rolled_back"] = True

    @asynccontextmanager
    async def _session():
        yield _S()

    async def _due_followups(session, *, limit=200):
        return state["due"]

    async def _claim_followup(session, lead_id):
        return state["claim_results"].get(str(lead_id), True)

    async def _create_notification(session, *, lead_id, salesperson_id, due_on):
        state["create_calls"].append(
            {"lead_id": str(lead_id), "salesperson_id": str(salesperson_id), "due_on": due_on}
        )
        return {"id": str(uuid4())}

    monkeypatch.setattr(task, "make_task_session", _session)
    monkeypatch.setattr(lead_followup_repo, "due_followups", _due_followups)
    monkeypatch.setattr(lead_followup_repo, "claim_followup", _claim_followup)
    monkeypatch.setattr(lead_followup_repo, "create_notification", _create_notification)
    return state


def _lead(**over):
    base = {
        "id": str(uuid4()), "name": "Hemant", "phone": "+919426529230",
        "followup_due_on": "2026-10-01", "assigned_to": None, "created_by": None,
    }
    base.update(over)
    return base


def _run(wired_state):
    return asyncio.run(task._run())


class TestRecipient:
    def test_assignee_wins_when_set(self):
        lead = _lead(assigned_to=ASSIGNEE, created_by=CREATOR)
        assert task._recipient(lead) == ASSIGNEE

    def test_creator_is_the_fallback(self):
        lead = _lead(assigned_to=None, created_by=CREATOR)
        assert task._recipient(lead) == CREATOR

    def test_neither_set_is_none(self):
        lead = _lead(assigned_to=None, created_by=None)
        assert task._recipient(lead) is None


class TestRun:
    def test_no_due_leads_is_a_clean_zero(self, wired):
        wired["due"] = []

        out = _run(wired)

        assert out == {"due": 0, "notified": 0}

    def test_creates_one_notification_per_claimed_lead(self, wired):
        lead = _lead(assigned_to=ASSIGNEE)
        wired["due"] = [lead]

        out = _run(wired)

        assert out == {"due": 1, "notified": 1}
        assert wired["create_calls"] == [
            {"lead_id": lead["id"], "salesperson_id": ASSIGNEE, "due_on": lead["followup_due_on"]}
        ]
        assert wired["committed"]

    def test_already_claimed_row_creates_no_notification(self, wired):
        lead = _lead(assigned_to=ASSIGNEE)
        wired["due"] = [lead]
        wired["claim_results"] = {lead["id"]: False}

        out = _run(wired)

        assert out == {"due": 1, "notified": 0}
        assert wired["create_calls"] == []

    def test_lead_with_no_recipient_is_logged_not_notified(self, wired):
        lead = _lead(assigned_to=None, created_by=None)
        wired["due"] = [lead]

        out = _run(wired)

        assert out == {"due": 1, "notified": 0}
        assert wired["create_calls"] == []

    def test_one_bad_row_does_not_stop_the_batch(self, wired, monkeypatch):
        good = _lead(assigned_to=ASSIGNEE)
        bad = _lead(assigned_to=ASSIGNEE)
        wired["due"] = [bad, good]

        real_claim = lead_followup_repo.claim_followup

        async def _boom(session, lead_id):
            if str(lead_id) == bad["id"]:
                raise RuntimeError("simulated failure")
            return await real_claim(session, lead_id)

        monkeypatch.setattr(lead_followup_repo, "claim_followup", _boom)

        out = _run(wired)

        assert out == {"due": 2, "notified": 1}
        assert wired["create_calls"] == [
            {"lead_id": good["id"], "salesperson_id": ASSIGNEE, "due_on": good["followup_due_on"]}
        ]
