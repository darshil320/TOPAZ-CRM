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
