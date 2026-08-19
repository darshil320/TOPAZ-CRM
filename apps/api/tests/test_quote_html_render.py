"""The quotation template actually renders — photo column included.

Every other document test in this repo covers the PURE context builder, which is the
right default. This file exists for the one thing a context test structurally cannot
see: `{% if has_photos %}` guards the header cell AND the body cell, in two separate
places in templates/quotation.html. If those two ever disagree the table renders with
mismatched column counts — valid Jinja, valid Python, a visibly broken PDF.

Jinja2 is imported by the renderer, so this is skipped where the templating dep is
absent (the repo's import-light rule for the pure suite).
"""
import re

import pytest

pytest.importorskip("jinja2")

from src.services.quote_html import render_quote_html  # noqa: E402

_PNG_URI = "data:image/png;base64,iVBORw0KGgo="


def _quote(items):
    return {
        "quote_no": "QTN-2627-0042", "revision_no": 1, "status": "sent",
        "created_at": "2026-08-07", "valid_until": "2026-08-22", "place_of_supply": "GJ",
        "subtotal": "1000.00", "discount_amount": "0.00", "taxable_value": "1000.00",
        "cgst": "90.00", "sgst": "90.00", "igst": "0.00", "grand_total": "1180.00",
        "terms": "50% advance.", "notes": "", "items": items,
    }


def _item(**over):
    base = {
        "description": "3-seater sofa", "dimensions": "210x90", "material": "Teak",
        "fabric": None, "polish": None, "customization": None, "qty": "1", "unit": "nos",
        "unit_price": "1000.00", "hsn": "9401", "gst_rate": "18.00",
        "line_total": "1000.00",
    }
    base.update(over)
    return base


def _column_counts(html: str) -> tuple[int, int]:
    """(header cells, cells in the first body row) of the LINE ITEMS table."""
    thead = re.search(r"<thead>(.*?)</thead>", html, re.S)
    first_row = re.search(r"<tbody>\s*<tr>(.*?)</tr>", html, re.S)
    assert thead and first_row, "line item table not found in rendered HTML"
    return len(re.findall(r"<th", thead.group(1))), len(re.findall(r"<td", first_row.group(1)))


def test_header_and_body_column_counts_match_with_photos():
    html = render_quote_html(_quote([_item(photo_data_uri=_PNG_URI)]), {"name": "Ravi"})
    assert _column_counts(html) == (8, 8)
    assert _PNG_URI in html
    assert "Photo" in html


def test_header_and_body_column_counts_match_without_photos():
    html = render_quote_html(_quote([_item()]), {"name": "Ravi"})
    assert _column_counts(html) == (7, 7)
    # The column is gone entirely, not present-and-empty. Asserted on the TABLE, not
    # the whole document: the .col-photo CSS rule is always in the <style> block, so
    # searching the full HTML for it would pass vacuously.
    assert 'class="col-photo"' not in html
    assert "No photo" not in html


def test_unphotographed_line_prints_no_photo_when_the_column_exists():
    html = render_quote_html(
        _quote([_item(description="Sofa", photo_data_uri=_PNG_URI), _item(description="Table")]),
        {"name": "Ravi"},
    )
    header, body = _column_counts(html)
    assert header == body == 8
    assert "No photo" in html, "a line without a photo must say so, not collapse the row"


def test_the_priced_columns_are_still_there():
    """The merge is photos-only: the quotation must still be a priced GST document."""
    html = render_quote_html(_quote([_item(photo_data_uri=_PNG_URI)]), {"name": "Ravi"})
    for expected in ("HSN", "Rate", "GST%", "Amount", "Grand Total", "9401"):
        assert expected in html, f"missing {expected!r} from the priced quotation"
