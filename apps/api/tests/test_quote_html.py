"""Quote HTML context builder — pure, no Jinja/browser needed."""
from decimal import Decimal

from src.services.quote_html import build_quote_context, _inr


def _quote(place="GJ"):
    return {
        "quote_no": "QTN-2627-0001",
        "revision_no": 1,
        "status": "sent",
        "created_at": "2026-07-24",
        "valid_until": "2026-08-08",
        "place_of_supply": place,
        "subtotal": Decimal("3500.00"),
        "discount_amount": Decimal("0.00"),
        "taxable_value": Decimal("3500.00"),
        "cgst": Decimal("140.00"),
        "sgst": Decimal("140.00"),
        "igst": Decimal("0.00"),
        "grand_total": Decimal("3780.00"),
        "terms": "50% advance.",
        "notes": "internal",
        "items": [
            {"description": "3-seater sofa", "dimensions": "84in", "material": "Teak",
             "fabric": None, "polish": None, "customization": None, "qty": Decimal("1"),
             "unit": "nos", "unit_price": Decimal("1000.00"), "hsn": "9401",
             "gst_rate": Decimal("18.00"), "line_total": Decimal("1000.00")},
        ],
    }


def test_indian_grouping():
    assert _inr(Decimal("126789.50")) == "1,26,789.50"
    assert _inr(Decimal("1000")) == "1,000.00"
    assert _inr(Decimal("999.5")) == "999.50"


def test_intra_state_shows_cgst_sgst():
    ctx = build_quote_context(_quote("GJ"), {"name": "Hemant", "phone": "+91"})
    assert ctx["intra"] is True
    assert ctx["cgst"] == "140.00" and ctx["sgst"] == "140.00"
    assert ctx["grand_total"] == "3,780.00"
    assert ctx["grand_total_words"].startswith("Rupees Three Thousand Seven Hundred Eighty")


def test_inter_state_uses_igst_flag():
    ctx = build_quote_context(_quote("MH"), {"name": "Hemant", "phone": None})
    assert ctx["intra"] is False


def test_specs_joined_and_customer_defaulted():
    ctx = build_quote_context(_quote(), {"name": None, "phone": None})
    assert ctx["customer"]["name"] == "Customer"
    assert ctx["items"][0]["specs"] == "84in · Teak"
    assert ctx["items"][0]["line_total"] == "1,000.00"


# ─── Line photos on the priced document (merged with the job card's picture) ──
#
# The quotation now shows the SAME photo per line that the job card shows. Only the
# photograph is shared — the price columns stay out of the job card and the job card's
# spec block stays out of the price table. These tests hold both halves of that.

_PNG_URI = "data:image/png;base64,iVBORw0KGgo="


def test_photo_data_uri_is_carried_onto_the_line():
    quote = _quote()
    quote["items"][0]["photo_data_uri"] = _PNG_URI

    ctx = build_quote_context(quote, {"name": "Ravi"})

    assert ctx["items"][0]["photo"] == _PNG_URI
    assert ctx["has_photos"] is True


def test_no_photos_means_no_column():
    """A quotation for which nothing was photographed must look exactly as it always
    did — not grow a page-width strip of empty cells."""
    ctx = build_quote_context(_quote(), {"name": "Ravi"})

    assert ctx["items"][0]["photo"] is None
    assert ctx["has_photos"] is False


def test_one_photo_among_many_still_renders_the_column():
    """has_photos is ANY, not ALL: the photographed lines must show, and the rest print
    "No photo" rather than being silently dropped from the document."""
    quote = _quote()
    quote["items"] = [
        {**quote["items"][0], "description": "Sofa", "photo_data_uri": _PNG_URI},
        {**quote["items"][0], "description": "Table"},
    ]

    ctx = build_quote_context(quote, {"name": "Ravi"})

    assert ctx["has_photos"] is True
    assert [it["photo"] for it in ctx["items"]] == [_PNG_URI, None]


def test_context_builder_stays_pure_no_key_resolution_here():
    """The builder must never see a storage KEY — resolving and fetching is the
    caller's job (tasks/pdf.py). A key leaking through would mean Playwright being
    handed a private-bucket path mid-render, which is the failure this split prevents."""
    quote = _quote()
    quote["items"][0]["photo_key"] = "media/abc/thumb.jpg"   # deliberately NOT inlined

    ctx = build_quote_context(quote, {"name": "Ravi"})

    assert ctx["items"][0]["photo"] is None
    assert ctx["has_photos"] is False


def test_money_is_still_on_the_quotation():
    """Guards the merge from going too far the other way: adding photos must not have
    turned the priced document into a job card."""
    ctx = build_quote_context(_quote(), {"name": "Ravi"})

    assert ctx["grand_total"] == _inr(Decimal("3780.00"))
    assert ctx["items"][0]["unit_price"] == _inr(Decimal("1000.00"))
    assert ctx["items"][0]["line_total"] == _inr(Decimal("1000.00"))
    assert ctx["items"][0]["hsn"] == "9401"
