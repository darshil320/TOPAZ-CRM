"""tasks.pdf._render_and_store — the quotation PDF behind "Share" and "Send".

Pinned here:
  * every render writes its OWN Storage key. A shared key is upserted in place, so a
    slow render of an old draft could overwrite a newer render's bytes after the newer
    one had already been filed as current — a priced document silently wrong.
  * pdf_key is only moved if the quotation is unchanged since the render read it
    (set_pdf_key's rendered_from guard). A render superseded by an edit files nothing:
    no documents row, no commit, returns None — the next Share renders afresh — and
    its uploaded object is removed rather than left as an unreferenced priced PDF.

Every collaborator stubbed — no DB, no Storage, no Chromium.
"""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from src.tasks import pdf as task

QUOTE_ID = uuid4()
SEEN = datetime(2026, 10, 24, 10, 0, tzinfo=timezone.utc)


@pytest.fixture
def wired(monkeypatch):
    state = {
        "fresh": True,
        "uploads": [],
        "set_calls": [],
        "documents": [],
        "committed": False,
        "removed": [],
        "remove_error": None,
    }

    class _S:
        async def commit(self):
            state["committed"] = True

        async def rollback(self):
            pass

    @asynccontextmanager
    async def _session():
        yield _S()

    async def _get_quotation(session, quotation_id):
        return {"id": quotation_id, "quote_no": "QTN-0042", "revision_no": 1,
                "customer_id": str(uuid4()), "updated_at": SEEN, "items": []}

    async def _load_customer(session, customer_id):
        return {"name": "Hemant", "phone": None}

    async def _resolve_photo_keys(session, source, items):
        return items

    async def _next_version(session, entity_type, entity_id):
        return len(state["documents"]) + 1

    async def _insert_document(session, **kw):
        state["documents"].append(kw)

    async def _set_pdf_key(session, quotation_id, key, *, rendered_from=None):
        state["set_calls"].append((key, rendered_from))
        return state["fresh"]

    monkeypatch.setattr(task, "make_task_session", _session)
    monkeypatch.setattr(task.repo, "get_quotation", _get_quotation)
    monkeypatch.setattr(task.repo, "set_pdf_key", _set_pdf_key)
    monkeypatch.setattr(task, "_load_customer", _load_customer)
    monkeypatch.setattr(task.job_card_repo, "resolve_photo_keys", _resolve_photo_keys)
    monkeypatch.setattr(task, "inline_photos", lambda items, document: items)
    monkeypatch.setattr(task.quote_html, "render_quote_html", lambda quote, customer: "<html/>")
    monkeypatch.setattr(task.pdf_engine, "render_html_to_pdf", lambda html: b"%PDF-1.7")
    monkeypatch.setattr(task, "upload_bytes",
                        lambda bucket, key, data, ctype: state["uploads"].append(key) or key)
    monkeypatch.setattr(task.document_repo, "next_version", _next_version)
    monkeypatch.setattr(task.document_repo, "insert_document", _insert_document)

    async def _remove(bucket, keys):
        if state["remove_error"]:
            raise state["remove_error"]
        state["removed"].extend(keys)

    monkeypatch.setattr(task, "remove_objects_async", _remove)
    return state


def _render():
    return asyncio.run(task._render_and_store(QUOTE_ID))


def test_each_render_gets_its_own_storage_key(wired):
    first = _render()
    second = _render()

    assert first != second
    assert wired["uploads"] == [first, second]
    assert all(k.startswith("quotes/QTN-0042-r1-") and k.endswith(".pdf") for k in (first, second))


def test_pdf_key_is_guarded_by_the_snapshot_the_render_read(wired):
    key = _render()

    assert wired["set_calls"] == [(key, SEEN)]
    assert wired["removed"] == []
    assert len(wired["documents"]) == 1
    assert wired["documents"][0]["storage_key"] == key
    assert wired["committed"]


def test_a_render_superseded_by_an_edit_files_nothing(wired):
    wired["fresh"] = False

    assert _render() is None
    assert wired["documents"] == [], "a stale render must not be registered"
    assert not wired["committed"]
    assert wired["removed"] == wired["uploads"], "the stale object must not be left behind"


def test_a_failed_stale_cleanup_is_logged_not_raised(wired):
    """The render already returned nothing useful; a Storage hiccup removing the
    orphan must not turn into a Celery retry that renders the stale draft again."""
    wired["fresh"] = False
    wired["remove_error"] = task.StorageError("down")

    assert _render() is None
