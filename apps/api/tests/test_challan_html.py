"""Pure tests for services/challan_html.py — TOPAZ'S OWN challan format (0037).

Asserted against the client's supplied paper challan (sample "T.F 66"). Rendering to PDF
is manual-integration (as with receipts); what must not regress is WHAT GOES ON THE PAPER:
their two-column tick table, the two money lines, and the absence of any tax content.
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
    """Their pad prints `  /  / 2026`, so the filled version matches that shape."""
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
    """A blank prints as their pre-printed rule, to be written in by hand."""
    ctx = challan_html.build_challan_context(
        challan(customer={"name": "Someone"}, dp_code=None, delivery={})
    )
    assert ctx["customer"]["address"] == ""
    assert ctx["customer"]["mobile"] == ""
    assert ctx["dp_code"] == ""
    assert ctx["delivery"]["tempo_number"] == ""


# ─── The PRODUCT / RECEIVED table ────────────────────────────────────────────
def test_every_line_gets_its_own_tick_row():
    ctx = challan_html.build_challan_context(
        challan(items=[{"description": "CENTER TABLE", "qty": 1},
                       {"description": "3-SEATER SOFA", "qty": 1}])
    )
    assert [i["sr"] for i in ctx["items"]] == [1, 2]
    assert [i["product"] for i in ctx["items"]] == ["CENTER TABLE", "3-SEATER SOFA"]
    assert ctx["item_count"] == 2


def test_a_single_piece_prints_bare_like_their_sample():
    ctx = challan_html.build_challan_context(challan())
    assert ctx["items"][0]["product"] == "CENTER TABLE"


def test_a_multiple_quantity_shows_the_count():
    """One tick box for an unstated quantity is ambiguous at the tailgate."""
    ctx = challan_html.build_challan_context(
        challan(items=[{"description": "DINING CHAIR", "qty": 6}])
    )
    assert ctx["items"][0]["product"] == "DINING CHAIR × 6"


def test_a_decimal_quantity_of_one_still_prints_bare():
    ctx = challan_html.build_challan_context(
        challan(items=[{"description": "CENTER TABLE", "qty": 1.00}])
    )
    assert ctx["items"][0]["product"] == "CENTER TABLE"


def test_a_whole_decimal_quantity_drops_its_paise():
    ctx = challan_html.build_challan_context(
        challan(items=[{"description": "DINING CHAIR", "qty": 6.00}])
    )
    assert ctx["items"][0]["product"] == "DINING CHAIR × 6"


# ─── A consignment can span several of one customer's orders (0040) ──────────
# One recipient signs ONE challan for everything of theirs on the lorry, even when the
# pieces came off two different orders. Their paper has no order column, so the order
# number rides as a sub-label under the product — and ONLY when it is needed to
# disambiguate, because printing "ORD-…" on every line of a single-order run is noise on a
# document a customer reads at their front door.


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
    assert [i["order_no"] for i in ctx["items"]] == ["ORD-2627-0041", "ORD-2627-0058"]


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
    """A pre-0040 render passes no order_no at all. It must read as a single-order run."""
    ctx = challan_html.build_challan_context(
        challan(items=[{"description": "CENTER TABLE", "qty": 1},
                       {"description": "BED", "qty": 1}])
    )
    assert ctx["orders"] == []
    assert ctx["spans_multiple_orders"] is False
    assert [i["order_no"] for i in ctx["items"]] == ["", ""]


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


def test_a_single_order_challan_stays_exactly_their_paper():
    """No order number anywhere on a one-order run — their sample has no such line."""
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(challan())
    assert "ORD-2627-0041" not in html


# ─── The two money lines ─────────────────────────────────────────────────────
def test_balance_uses_their_formatting_plain_digits_and_a_slash_dash():
    """Their sample reads "Balance Amount :- 31500/-" — no ₹, no comma grouping."""
    assert challan_html.build_challan_context(challan())["balance_due"] == "31500/-"


def test_a_settled_order_reads_zero_not_a_negative():
    for paid_off in (0, -250):
        ctx = challan_html.build_challan_context(challan(balance_due=paid_off))
        assert ctx["balance_due"] == "0/-", paid_off


def test_an_unknown_balance_is_blank_rather_than_a_guessed_figure():
    """The driver may collect against this line — a wrong figure is worse than none."""
    assert challan_html.build_challan_context(challan(balance_due=None))["balance_due"] == ""


def test_delivery_rent_is_blank_when_unset_like_their_sample():
    ctx = challan_html.build_challan_context(challan())
    assert ctx["delivery"]["delivery_rent"] == ""


def test_delivery_rent_prints_when_set():
    ctx = challan_html.build_challan_context(
        challan(delivery={**DELIVERY, "delivery_rent": 1200})
    )
    assert ctx["delivery"]["delivery_rent"] == "1200/-"


def test_paise_are_rounded_not_truncated():
    assert challan_html.build_challan_context(challan(balance_due=31500.60))["balance_due"] == "31501/-"


# ─── No tax content, by design ───────────────────────────────────────────────
def test_the_context_carries_no_tax_or_rate_fields_at_all():
    """Their challan is a hand-over receipt, not a tax invoice."""
    ctx = challan_html.build_challan_context(challan())
    for absent in ("totals", "cgst", "sgst", "igst", "taxable_value", "place_of_supply",
                   "intra", "with_values"):
        assert absent not in ctx, absent
    # Per line: the tick row, and (0040) which order the piece came off. Never a rate, an
    # HSN code or a line amount — selecting money we do not print is an invitation to
    # print it.
    for item in ctx["items"]:
        assert set(item) == {"sr", "product", "order_no"}


# ─── Rendering ───────────────────────────────────────────────────────────────
def test_render_reproduces_their_document():
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(challan())
    for expected in (
        "CHALLAN :- T.F 66",
        "NAME:-",
        "Mr. PANKAJ JI",
        "MOBILE NO :-",
        "D.P",
        "ASG",
        "TEMPO NUMBER",
        "GJ05 CU 3660",
        "Mr. Dinesh Patil",
        "Please hand-in the barrier of this challan",
        "PRODUCT",
        "CENTER TABLE",
        "Delivery rent :-",
        "Balance Amount :- 31500/-",
        "I have received furniture as per our placed order.",
        "Customer Signature:",
        "Dear Customer,",
        "Authorised Signature:",
        "Topaz Furniture &amp; Decors",
        "Udhna-Magdalla Road,",
        "Surat- 395009",
    ):
        assert expected in html, expected


def test_render_has_no_tax_columns():
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(challan())
    for absent in ("HSN", "GST", "Taxable", "Rate", "E-Way"):
        assert absent not in html, absent


def test_customer_name_is_html_escaped():
    """The name is user input and this document is printed and handed over."""
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(
        challan(customer={"name": "<script>alert(1)</script>"})
    )
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


def test_the_thank_you_letter_is_their_wording():
    pytest.importorskip("jinja2")
    html = challan_html.render_challan_html(challan())
    assert "prosperity of your sweet home" in html
    assert "TOPAZ FURNITURE" in html


# ─── The storage key ─────────────────────────────────────────────────────────
def test_challan_number_slugifies_for_the_storage_key():
    """"T.F 66" contains a dot and a space; a Storage key is also a URL path segment."""
    assert _slug("T.F 66") == "T-F-66"
    assert _slug("T.F 1024") == "T-F-1024"
