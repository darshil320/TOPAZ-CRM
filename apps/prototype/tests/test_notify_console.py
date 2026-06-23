"""Unit tests for the console notifier + the visit log store."""

import os

from src.notify.base import Alert
from src.notify.console import ConsoleNotifier
from src.store.visit_log import Visit, VisitLog


def test_console_notifier_prints_text(capsys):
    ConsoleNotifier(use_color=False).send(
        Alert(kind="repeat", text="Repeat customer visited — Hemant", to="+9190000")
    )
    out = capsys.readouterr().out
    assert "Repeat customer visited — Hemant" in out
    assert "+9190000" in out


def test_console_notifier_shows_media_url_when_present(capsys):
    ConsoleNotifier(use_color=False).send(
        Alert(
            kind="new",
            text="New customer visited",
            photo_path="data/captures/x.jpg",
            media_url="https://abc.ngrok.io/captures/x.jpg",
        )
    )
    out = capsys.readouterr().out
    assert "New customer visited" in out
    assert "https://abc.ngrok.io/captures/x.jpg" in out


def test_console_notifier_local_photo_when_no_media_url(capsys):
    ConsoleNotifier(use_color=False).send(
        Alert(kind="new", text="New customer visited", photo_path="data/captures/x.jpg")
    )
    out = capsys.readouterr().out
    assert "x.jpg" in out
    assert "not public" in out


def test_visit_log_append_and_read(tmp_path):
    path = os.path.join(tmp_path, "visits.jsonl")
    log = VisitLog(path)
    assert log.count() == 0
    log.append(Visit("2026-06-12T14:05:00", "repeat", "Hemant", "sofa", 0.91, None))
    log.append(Visit("2026-06-12T14:06:00", "new", None, None, 0.10, "cap.jpg"))
    assert log.count() == 2
    recent = log.recent()
    assert recent[-1].band == "new"
    assert recent[0].name == "Hemant"


def test_visit_log_recent_limit(tmp_path):
    path = os.path.join(tmp_path, "visits.jsonl")
    log = VisitLog(path)
    for i in range(5):
        log.append(Visit(f"t{i}", "repeat", f"P{i}", "sofa", 0.9, None))
    recent = log.recent(limit=2)
    assert len(recent) == 2
    assert recent[-1].name == "P4"


def test_visit_log_recent_missing_file():
    assert VisitLog("/nonexistent/visits.jsonl").recent() == []
