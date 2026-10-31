"""QR sticker layout + rendering — pure (segno is pure Python; no browser, no DB)."""
import re

import pytest
from src.services import qr_stickers as qs

BASE = "https://topaz.dmcdigital.in/p"
PRODUCTS = [
    {"name": "Royal Sofa", "qr_code": "7K3M9QXA"},
    {"name": "Teak <Dining> & Co", "qr_code": "0K3M1QXB"},
]


def test_every_preset_fits_an_a4_sheet():
    for size in qs.STICKER_SIZES.values():
        cols, rows = qs.sheet_grid(size)
        assert cols >= 1 and rows >= 1
        used_w = 2 * qs.SHEET_MARGIN_MM + cols * size.width_mm + (cols - 1) * qs.SHEET_GAP_MM
        used_h = 2 * qs.SHEET_MARGIN_MM + rows * size.height_mm + (rows - 1) * qs.SHEET_GAP_MM
        assert used_w <= qs.SHEET_WIDTH_MM and used_h <= qs.SHEET_HEIGHT_MM


def test_small_stickers_tile_densely():
    assert qs.sheet_grid(qs.STICKER_SIZES["small"]) == (7, 10)


def test_qr_never_wider_than_its_sticker():
    for size in qs.STICKER_SIZES.values():
        assert size.qr_mm <= min(size.width_mm, size.height_mm) - 2


def test_copies_are_adjacent():
    out = qs.expand_copies(PRODUCTS, 2)
    assert [p["qr_code"] for p in out] == ["7K3M9QXA", "7K3M9QXA", "0K3M1QXB", "0K3M1QXB"]


def test_zero_copies_is_refused():
    with pytest.raises(qs.StickerError):
        qs.expand_copies(PRODUCTS, 0)


def test_paginate_splits_and_keeps_the_remainder():
    assert qs.paginate(list(range(5)), 2) == [[0, 1], [2, 3], [4]]


def test_qr_svg_is_vector_and_self_sizing():
    svg = qs.qr_svg(f"{BASE}/7K3M9QXA")
    assert svg.startswith("<svg") and "viewBox" in svg
    assert not re.search(r'<svg[^>]*\swidth=', svg)


def test_roll_layout_is_one_sticker_per_page_at_label_size():
    ctx = qs.build_context(PRODUCTS, size_key="medium", layout="roll", copies=1, base_url=BASE)
    assert [len(p) for p in ctx["pages"]] == [1, 1]
    html = qs.render_stickers_html(PRODUCTS, size_key="medium", layout="roll", copies=1, base_url=BASE)
    assert "size: 38mm 25mm" in html


def test_sheet_layout_is_a4():
    html = qs.render_stickers_html(PRODUCTS, size_key="small", layout="sheet", copies=1, base_url=BASE)
    assert "size: 210.0mm 297.0mm" in html


def test_names_are_html_escaped():
    html = qs.render_stickers_html(PRODUCTS, size_key="large", layout="sheet", copies=1, base_url=BASE)
    assert "Teak &lt;Dining&gt; &amp; Co" in html
    assert "<Dining>" not in html


def test_small_sticker_shows_code_but_not_name():
    html = qs.render_stickers_html(PRODUCTS, size_key="small", layout="sheet", copies=1, base_url=BASE)
    assert "7K3M9QXA" in html
    assert "Royal Sofa" not in html


@pytest.mark.parametrize("kwargs, message", [
    ({"size_key": "huge", "layout": "sheet"}, "Unknown sticker size"),
    ({"size_key": "small", "layout": "fax"}, "Unknown layout"),
])
def test_bad_requests_name_the_problem(kwargs, message):
    with pytest.raises(qs.StickerError, match=message):
        qs.build_context(PRODUCTS, copies=1, base_url=BASE, **kwargs)


def test_empty_selection_is_refused():
    with pytest.raises(qs.StickerError, match="at least one product"):
        qs.build_context([], size_key="small", layout="sheet", copies=1, base_url=BASE)


def test_stickers_never_carry_a_price():
    products = [{"name": "Sofa", "qr_code": "7K3M9QXA", "base_price": 42000, "gst_rate": 18}]
    html = qs.render_stickers_html(products, size_key="large", layout="sheet", copies=1, base_url=BASE)
    assert "42000" not in html and "42,000" not in html and "GST" not in html


def test_preview_data_uri_is_a_scalable_svg_on_white():
    uri = qs.qr_data_uri(f"{BASE}/7K3M9QXA")
    assert uri.startswith("data:image/svg+xml")
    assert "viewBox" in uri and "xmlns" in uri
    assert "fff" in uri.lower()


def test_sticker_pdf_key_only_ever_holds_a_uuid():
    key = qs.sticker_pdf_key("0f9c1c26-1f6f-4c2e-9a3a-2b7f0f8c1111")
    assert key == "stickers/0f9c1c26-1f6f-4c2e-9a3a-2b7f0f8c1111.pdf"
    with pytest.raises(ValueError):
        qs.sticker_pdf_key("../quotes/QTN-1")


def test_worker_task_renders_and_stores_under_the_job_key(monkeypatch):
    from src.tasks import qr_stickers as task

    stored = {}
    monkeypatch.setattr(task.pdf_engine, "render_html_to_pdf", lambda html, css_page_size: b"%PDF-fake")
    monkeypatch.setattr(task, "upload_bytes", lambda bucket, key, data: stored.setdefault(key, data) and key)
    job = "0f9c1c26-1f6f-4c2e-9a3a-2b7f0f8c1111"
    key = task.render_qr_stickers(job, PRODUCTS, "small", "sheet", 1, BASE)
    assert key == f"stickers/{job}.pdf" and stored[key] == b"%PDF-fake"


def test_worker_task_does_not_retry_a_bad_request(monkeypatch):
    from src.tasks import qr_stickers as task

    monkeypatch.setattr(task, "upload_bytes", lambda *a: pytest.fail("uploaded"))
    assert task.render_qr_stickers("0f9c1c26-1f6f-4c2e-9a3a-2b7f0f8c1111", PRODUCTS, "huge",
                                   "sheet", 1, BASE) is None
