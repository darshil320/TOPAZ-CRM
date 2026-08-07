"""Pure tests for services/challan_html.py — TOPAZ'S UPDATED delivery challan format (T.F 4 sample).

Asserted against the client's supplied paper challan. What must not regress is WHAT GOES ON THE PAPER:
the header grid, the 4-column tick table, money lines formatted in INR, and signature/thanks blocks.
"""

from datetime import date

import pytest

from src.services import challan_html
from src.tasks.challan import _slug


CUSTOMER = {
    "name": "Mr. PANKAJ JI",
    "address": "301, Silver Heights, Vesu, Surat",
    "mobile": "9825011111",
}
DELIVERY = {
    "tempo_number": "GJ05 CU 3660",
    "driver_name": "Mr. Dinesh Patil",
    "driver_phone": "82000 55861",
    "delivery_rent": None,
    "notes": None,
}
ITEMS = [{"description": "CENTER TABLE", "qty": 1, "order_no": "ORD-2627-0041"}]


def challan(**overrides) -> dict:
    base = {
        "challan_no": "T.F 66",
        "challan_date": date(2026, 8, 6),
        "dp_code": "ASG",
        "balance_due": 31500,
        "customer": CUSTOMER,
        "delivery": DELIVERY,
        "items": ITEMS,
    }
    return {**base, **overrides}


# ─── The header block ────────────────────────────────────────────────────────
def test_their_challan_number_and_dp_code_carry_through_verbatim():
    ctx = challan_html.build_challan_context(challan())
    assert ctx["challan_no"] == "T.F 66"
    assert ctx["dp_code"] == "ASG"


def test_date_renders_in_their_dd_mm_yyyy_form():
    """Renders as DD / MM / YYYY."""
    assert challan_html.build_challan_context(challan())["challan_date"] == "06 / 08 / 2026"


def test_customer_name_address_and_mobile_are_all_present():
    ctx = challan_html.build_challan_context(challan())
    assert ctx["customer"]["name"] == "Mr. PANKAJ JI"
    assert ctx["customer"]["address"] == "301, Silver Heights, Vesu, Surat"
    assert ctx["customer"]["mobile"] == "9825011111"


def test_tempo_and_driver_details_are_present():
    ctx = challan_html.build_challan_context(challan())
    assert ctx["delivery"]["tempo_number"] == "GJ05 CU 3660"
    assert ctx["delivery"]["driver_name"] == "Mr. Dinesh Patil"
    assert ctx["delivery"]["driver_phone"] == "82000 55861"


def test_missing_fields_are_blank_not_placeholders():
    """A blank prints cleanly."""
    ctx = challan_html.build_challan_context(
        challan(customer={"name": "Someone"}, dp_code=None, delivery={})
    )
    assert ctx["customer"]["address"] == ""
    assert ctx["customer"]["mobile"] == ""
    assert ctx["dp_code"] == ""
    assert ctx["delivery"]["tempo_number"] == ""


# ─── The PRODUCT DESCRIPTION / QTY / RECEIVED table ─────────────────────────
def test_every_line_gets_its_own_tick_row():
    ctx = challan_html.build_challan_context(
        challan(items=[{"description": "CENTER TABLE", "qty": 1},
                       {"description": "3-SEATER SOFA", "qty": 1}])
    )
    assert [i["sr"] for i in ctx["items"][:2]] == ["01", "02"]
    assert [i["product"] for i in ctx["items"][:2]] == ["CENTER TABLE", "3-SEATER SOFA"]
    assert [i["qty"] for i in ctx["items"][:2]] == ["1", "1"]
    assert ctx["item_count"] == 2


def test_a_single_piece_prints_description_and_qty():
    ctx = challan_html.build_challan_context(challan())
    assert ctx["items"][0]["product"] == "CENTER TABLE"
    assert ctx["items"][0]["qty"] == "1"


def test_a_multiple_quantity_shows_the_count():
    ctx = challan_html.build_challan_context(
        challan(items=[{"description": "DINING CHAIR", "qty": 6}])
    )
    assert ctx["items"][0]["product"] == "DINING CHAIR"
    assert ctx["items"][0]["qty"] == "6"


def test_a_decimal_quantity_of_one_still_prints_bare():
    ctx = challan_html.build_challan_context(
        challan(items=[{"description": "CENTER TABLE", "qty": 1.00}])
    )
    assert ctx["items"][0]["qty"] == "1"


def test_a_whole_decimal_quantity_drops_its_paise():
    ctx = challan_html.build_challan_context(
        challan(items=[{"description": "DINING CHAIR", "qty": 6.00}])
    )
    assert ctx["items"][0]["qty"] == "6"


# ─── A consignment can span several of one customer's orders (0040) ──────────
def test_a_single_order_consignment_prints_no_order_labels():
    ctx = challan_html.build_challan_context(challan())
    assert ctx["spans_multiple_orders"] is False
    assert ctx["orders"] == ["ORD-2627-0041"]
    assert ctx["items"][0]["order_no"] == ""


def test_a_multi_order_consignment_labels_every_line_with_its_order():
    ctx = challan_html.build_challan_context(
        challan(items=[
            {"description": "CENTER TABLE", "qty": 1, "order_no": "ORD-2627-0041"},
            {"description": "3-SEATER SOFA", "qty": 1, "order_no": "ORD-2627-0058"},
        ])
    )
    assert ctx["spans_multiple_orders"] is True
    assert [i["order_no"] for i in ctx["items"][:2]] == ["ORD-2627-0041", "ORD-2627-0058"]


def test_the_orders_covered_are_listed_once_each_in_document_order():
    ctx = challan_html.build_challan_context(
        challan(items=[
            {"description": "CENTER TABLE", "qty": 1, "order_no": "ORD-2627-0058"},
            {"description": "BED", "qty": 1, "order_no": "ORD-2627-0041"},
            {"description": "3-SEATER SOFA", "qty": 1, "order_no": "ORD-2627-0058"},
        ])
    )
    assert ctx["orders"] == ["ORD-2627-0058", "ORD-2627-0041"]
    assert ctx["spans_multiple_orders"] is True


def test_items_with_no_order_number_do_not_invent_a_multi_order_challan():
    ctx = challan_html.build_challan_context(
        challan(items=[{"description": "CENTER TABLE", "qty": 1},
                       {"description": "BED", "qty": 1}])
    )
    assert ctx["orders"] == []
    assert ctx["spans_multiple_orders"] is False
    assert [i["order_no"] for i in ctx["items"][:2]] == ["", ""]


def test_a_multi_order_challan_prints_its_order_numbers():
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(
        challan(items=[
            {"description": "CENTER TABLE", "qty": 1, "order_no": "ORD-2627-0041"},
            {"description": "3-SEATER SOFA", "qty": 1, "order_no": "ORD-2627-0058"},
        ])
    )
    assert "ORD-2627-0041" in html
    assert "ORD-2627-0058" in html


def test_a_single_order_challan_stays_clean():
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(challan())
    assert "ORD-2627-0041" not in html


# ─── Money lines ─────────────────────────────────────────────────────────────
def test_balance_uses_inr_formatting():
    assert challan_html.build_challan_context(challan())["balance_due"] == "₹ 31,500"


def test_a_settled_order_reads_zero():
    for paid_off in (0, -250):
        ctx = challan_html.build_challan_context(challan(balance_due=paid_off))
        assert ctx["balance_due"] == "₹ 0", paid_off


def test_an_unknown_balance_is_blank_rather_than_a_guessed_figure():
    assert challan_html.build_challan_context(challan(balance_due=None))["balance_due"] == ""


def test_delivery_rent_is_blank_when_unset():
    ctx = challan_html.build_challan_context(challan())
    assert ctx["delivery"]["delivery_rent"] == ""


def test_delivery_rent_prints_when_set():
    ctx = challan_html.build_challan_context(
        challan(delivery={**DELIVERY, "delivery_rent": 1200})
    )
    assert ctx["delivery"]["delivery_rent"] == "₹ 1,200"


def test_paise_are_rounded_not_truncated():
    assert challan_html.build_challan_context(challan(balance_due=31500.60))["balance_due"] == "₹ 31,501"


# ─── No tax content ──────────────────────────────────────────────────────────
def test_the_context_carries_no_tax_or_rate_fields_at_all():
    ctx = challan_html.build_challan_context(challan())
    for absent in ("totals", "cgst", "sgst", "igst", "taxable_value", "place_of_supply",
                   "intra", "with_values"):
        assert absent not in ctx, absent
    for item in ctx["items"][:1]:
        assert set(item) == {"sr", "product", "qty", "order_no"}


# ─── Rendering ───────────────────────────────────────────────────────────────
def test_render_reproduces_their_document():
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(challan())
    for expected in (
        "DELIVERY CHALLAN",
        "T.F 66",
        "CUSTOMER NAME",
        "Mr. PANKAJ JI",
        "MOBILE NO.",
        "DESIGN PARTNER",
        "ASG",
        "VEHICLE NO.",
        "GJ05 CU 3660",
        "DRIVER NAME",
        "Mr. Dinesh Patil",
        "PRODUCT DESCRIPTION",
        "CENTER TABLE",
        "DECLARATION",
        "I confirm that the goods listed above have been received in full, in good condition and as per the order placed.",
        "BALANCE PAYABLE",
        "₹ 31,500",
        "CUSTOMER SIGNATURE",
        "FOR TOPAZ FURNITURE &amp; DECORS",
        "A NOTE OF THANKS",
        "Congratulations on your new home",
        "Topaz Furniture &amp; Decors",
    ):
        assert expected in html, expected


def test_render_has_no_tax_columns():
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(challan())
    for absent in ("HSN", "CGST", "SGST", "IGST", "Taxable", "Rate", "E-Way"):
        assert absent not in html, absent


def test_customer_name_is_html_escaped():
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(
        challan(customer={"name": "<script>alert(1)</script>"})
    )
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


def test_the_thank_you_letter_is_their_wording():
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(challan())
    assert "Congratulations on your new home" in html
    assert "Topaz Furniture" in html


# ─── The storage key ─────────────────────────────────────────────────────────
def test_challan_number_slugifies_for_the_storage_key():
    assert _slug("T.F 66") == "T-F-66"
    assert _slug("T.F 1024") == "T-F-1024"
