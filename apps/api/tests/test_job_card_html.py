"""Pure tests for the job card context builder.

No DB, no network, no Jinja — proves the display logic that turns raw item rows
into the sheet the showroom recognises, and pins the one rule that makes this
document safe to send to an outside workshop: IT CARRIES NO MONEY.
"""
import pytest

from src.services.job_card_html import (
    SPEC_LABELS,
    build_description_block,
    build_job_card_context,
)


def _item(**over):
    base = {
        "description": "Dining Top",
        "product_name": "Dining Top",
        "dimensions": '78" x 40"',
        "qty": "1",
        "unit": "nos",
        "material": None,
        "fabric": None,
        "polish": None,
        "customization": None,
        "spec_notes": None,
        "photo_data_uri": None,
    }
    return {**base, **over}


def _header(**over):
    base = {
        "doc_label": "JOB CARD",
        "doc_no": "ORD-2627-0012",
        "client_name": "Mrs. Dakshita",
        "order_date": "2026-06-16",
        "delivery_date": None,
        "dealt_with": "Aarshit",
        "status": "confirmed",
    }
    return {**base, **over}


# ── The money-blind guarantee (migration 0027 header) ───────────────────────
_MONEY_KEYS = {
    "unit_price", "line_total", "grand_total", "subtotal", "taxable_value",
    "cgst", "sgst", "igst", "discount_amount", "amount", "price", "total",
    "advance_expected", "hsn", "gst_rate",
}


def test_context_contains_no_money_at_any_level():
    """The single most important test in this file.

    A job card goes to outside vendor workshops. If a price ever reaches this
    context it reaches the PDF, and the module 13 money-blind requirement is
    broken by a document rather than by RLS — where no RLS test would catch it.
    """
    ctx = build_job_card_context(
        _header(),
        [_item(material="Marble", spec_notes="Molding :-\nNew Molding")],
    )

    def walk(node, path="ctx"):
        if isinstance(node, dict):
            for k, v in node.items():
                assert k not in _MONEY_KEYS, f"money key '{k}' leaked at {path}"
                walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")

    walk(ctx)


def test_money_fields_on_the_input_row_are_not_carried_through():
    """Even when the caller hands us a full item row, prices must not survive."""
    ctx = build_job_card_context(
        _header(),
        [_item(unit_price="42000", line_total="42000", hsn="9403", gst_rate="18")],
    )
    rendered = repr(ctx)
    assert "42000" not in rendered
    assert "9403" not in rendered


# ── Description block ───────────────────────────────────────────────────────
def test_description_groups_are_labelled_in_declared_order():
    groups = build_description_block(
        _item(material="Off White Base Brown Figure", polish="Matte", fabric="Linen")
    )
    assert [g["label"] for g in groups] == ["Material", "Fabric", "Polish"]
    assert groups[0]["lines"] == ["Off White Base Brown Figure"]


def test_empty_and_whitespace_spec_fields_are_dropped_not_printed_blank():
    groups = build_description_block(_item(material="   ", fabric="", polish=None))
    assert groups == []


def test_spec_notes_free_text_keeps_its_own_lines_and_gets_no_invented_label():
    groups = build_description_block(
        _item(spec_notes="Marble Detail :-\nAs On Photo Design\n\nMolding :-\nNew Molding")
    )
    assert len(groups) == 1
    assert groups[0]["label"] is None
    # Blank lines dropped, authored lines preserved in order.
    assert groups[0]["lines"] == [
        "Marble Detail :-", "As On Photo Design", "Molding :-", "New Molding",
    ]


def test_structured_fields_come_before_free_text():
    groups = build_description_block(_item(material="Teak", spec_notes="Ready In Showroom"))
    assert groups[0]["label"] == "Material"
    assert groups[1]["label"] is None


def test_spec_labels_cover_every_structured_column_the_repo_selects():
    assert [f for f, _ in SPEC_LABELS] == ["material", "fabric", "polish", "customization"]


# ── Rows ────────────────────────────────────────────────────────────────────
def test_rows_are_numbered_from_one_and_count_is_exposed():
    ctx = build_job_card_context(_header(), [_item(), _item(), _item()])
    assert [r["sr"] for r in ctx["items"]] == [1, 2, 3]
    assert ctx["item_count"] == 3


def test_missing_dimensions_render_an_em_dash_not_an_empty_cell():
    ctx = build_job_card_context(_header(), [_item(dimensions=None)])
    assert ctx["items"][0]["size"] == "—"


def test_product_falls_back_to_description_for_a_custom_piece():
    ctx = build_job_card_context(
        _header(), [_item(product_name=None, description="Custom fluted base")]
    )
    assert ctx["items"][0]["product"] == "Custom fluted base"


def test_whole_quantities_lose_the_decimal_tail():
    ctx = build_job_card_context(
        _header(), [_item(qty="2.00"), _item(qty="1.50"), _item(qty="3")]
    )
    assert [r["qty"] for r in ctx["items"]] == ["2", "1.5", "3"]


def test_photo_passes_through_and_absence_is_none_for_the_no_photo_cell():
    ctx = build_job_card_context(
        _header(), [_item(photo_data_uri="data:image/jpeg;base64,AAA"), _item()]
    )
    assert ctx["items"][0]["photo"] == "data:image/jpeg;base64,AAA"
    assert ctx["items"][1]["photo"] is None


# ── Header ──────────────────────────────────────────────────────────────────
def test_header_maps_the_showroom_sheet_fields():
    ctx = build_job_card_context(_header(), [_item()])
    assert ctx["doc_no"] == "ORD-2627-0012"
    assert ctx["client_name"] == "Mrs. Dakshita"
    assert ctx["dealt_with"] == "Aarshit"
    assert ctx["doc_label"] == "JOB CARD"


def test_absent_delivery_date_renders_an_em_dash_rather_than_inventing_one():
    """A quotation has no committed delivery date. Printing today's date, or a
    blank, would both read as a promise."""
    ctx = build_job_card_context(_header(delivery_date=None), [_item()])
    assert ctx["delivery_date"] == "—"


def test_missing_client_and_salesperson_degrade_to_em_dash():
    ctx = build_job_card_context(_header(client_name=None, dealt_with=None), [_item()])
    assert ctx["client_name"] == "—"
    assert ctx["dealt_with"] == "—"


def test_date_objects_render_in_the_sheets_dd_mm_yy_format():
    from datetime import date

    ctx = build_job_card_context(_header(order_date=date(2026, 6, 16)), [_item()])
    assert ctx["order_date"] == "16/06/26"


def test_seller_defaults_are_present_and_overridable():
    ctx = build_job_card_context(_header(), [_item()])
    assert ctx["seller"]["name"] == "Topaz Furniture"
    ctx2 = build_job_card_context(_header(), [_item()], {"phone": "+912612345678"})
    assert ctx2["seller"]["phone"] == "+912612345678"
    assert ctx2["seller"]["name"] == "Topaz Furniture"  # unspecified keys survive


def test_builder_does_not_mutate_its_inputs():
    """CLAUDE.md immutability rule — the caller's rows are reused by the sender."""
    header, items = _header(), [_item(material="Teak")]
    header_before, items_before = dict(header), [dict(items[0])]
    build_job_card_context(header, items)
    assert header == header_before
    assert items == items_before


def test_empty_item_list_yields_an_empty_sheet_not_a_crash():
    ctx = build_job_card_context(_header(), [])
    assert ctx["items"] == [] and ctx["item_count"] == 0
