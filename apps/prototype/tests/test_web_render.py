"""Unit tests for the web view's pure render_page + safe capture-path resolver."""

import os

from src.store.visit_log import Visit
from src.web import _safe_capture_path, render_page


def test_render_empty_shows_placeholder():
    out = render_page([])
    assert "No visits yet" in out
    assert "<table" in out


def test_render_includes_visit_fields():
    visits = [
        Visit("2026-06-12T14:05:00", "repeat", "Hemant", "7-seater sofa", 0.91, None),
        Visit("2026-06-12T14:06:00", "new", None, None, 0.10, "data/captures/x.jpg"),
    ]
    out = render_page(visits)
    assert "Hemant" in out
    assert "7-seater sofa" in out
    assert "0.91" in out
    # new visitor's photo is referenced by basename under the captures prefix
    assert "/captures/x.jpg" in out
    # new visitor with no name falls back to a label
    assert "New visitor" in out


def test_render_escapes_html():
    visits = [Visit("t", "repeat", "<script>", "a&b", 0.5, None)]
    out = render_page(visits)
    assert "<script>" not in out
    assert "&lt;script&gt;" in out
    assert "a&amp;b" in out


def test_safe_capture_path_allows_known_file(tmp_path):
    captures = str(tmp_path)
    fpath = os.path.join(captures, "ok.jpg")
    with open(fpath, "wb") as fh:
        fh.write(b"\xff\xd8\xff")  # jpeg-ish bytes
    resolved = _safe_capture_path(captures, "/captures/ok.jpg")
    assert resolved == fpath


def test_safe_capture_path_blocks_traversal(tmp_path):
    captures = str(tmp_path)
    # Even a traversal attempt resolves via basename only -> file won't exist -> None
    assert _safe_capture_path(captures, "/captures/../../etc/passwd") is None


def test_safe_capture_path_missing_file(tmp_path):
    assert _safe_capture_path(str(tmp_path), "/captures/nope.jpg") is None
