"""Job card (spec sheet) → HTML for the PDF.

The context builder is PURE and golden-tested; Jinja2 is imported lazily inside
the render function so the core suite runs without the templating dep. Same shape
as quote_html.py — deliberately, so there is one way to build a document here.

═══ THE JOB CARD CARRIES NO MONEY ═══
There is no unit_price, no line_total, no grand_total, and no code path that adds
one. That is not a rendering preference: it is what makes the identical file safe
to send to both the customer and an outside workshop, and it is why this document
satisfies the module 13 money-blind requirement rather than fighting it. The
priced document is the quotation PDF (quote_html.py) — keep them separate.

`build_job_card_context` never touches the DB or the network. Photos arrive as
already-resolved data URIs (job_card_repo + tasks/job_card do the I/O), because
Playwright rendering a private-bucket URL mid-render is exactly how the quotation
renderer broke once before (STATE.md 2026-07-26, commit 0a43348).
"""

from datetime import date
from pathlib import Path

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
_TEMPLATE_NAME = "job_card.html"

# Seller identity mirrors quote_html.SELLER_DEFAULTS so both documents brand alike.
SELLER_DEFAULTS = {
    "name": "Topaz Furniture",
    "tagline": "Fine Furniture & Interiors",
    "address": "Bhatar Road, Surat, Gujarat",
    "phone": "",
    "brand_color": "#B45309",  # amber-700
}

# Structured spec columns → the label printed on the job card, in print order.
# Data-driven so adding a column is one entry here, not a template edit.
SPEC_LABELS: tuple[tuple[str, str], ...] = (
    ("material", "Material"),
    ("fabric", "Fabric"),
    ("polish", "Polish"),
    ("customization", "Customization"),
)


def _fmt_date(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, str):
        return value[:10]
    if isinstance(value, date):
        return value.strftime("%d/%m/%y")
    return str(value)


def _qty(value) -> str:
    """Whole numbers print without a trailing .00 — a job card says '2', not '2.00'."""
    if value is None:
        return ""
    text = str(value)
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def build_description_block(item: dict) -> list[dict]:
    """The DESCRIPTION cell, as headed groups.

    Mirrors how the showroom writes these by hand:
        Material :-
        Off White Base Brown Figure
        Molding :-
        New Molding
    Structured columns come first as labelled groups, then `spec_notes` free text
    is appended verbatim (already-headed prose the columns cannot hold). Empty
    fields are dropped rather than printed blank.
    """
    groups: list[dict] = []
    for field, label in SPEC_LABELS:
        value = (item.get(field) or "").strip() if isinstance(item.get(field), str) else item.get(field)
        if value:
            groups.append({"label": label, "lines": [str(value)]})

    notes = item.get("spec_notes")
    if notes and str(notes).strip():
        # Free text is authored with its own headings; keep the author's line breaks
        # and do not invent a label for it.
        lines = [ln.rstrip() for ln in str(notes).strip().splitlines() if ln.strip()]
        if lines:
            groups.append({"label": None, "lines": lines})
    return groups


def paginate(items: list[dict], per_page: int) -> list[list[dict]]:
    """Split items into page-sized chunks. Always at least one (possibly empty) page.

    This exists for the IMAGE output. A PDF paginates itself, but a job card
    screenshotted as one tall JPEG becomes an unreadable ribbon once it holds more
    than a handful of rows — and WhatsApp recompresses it, so the text degrades
    exactly where the workshop needs to read a dimension. Several legible images
    beat one unreadable one.
    """
    if per_page < 1:
        raise ValueError("per_page must be at least 1")
    if not items:
        return [[]]
    return [items[i:i + per_page] for i in range(0, len(items), per_page)]


def build_job_card_context(
    header: dict,
    items: list[dict],
    seller: dict | None = None,
    *,
    sr_offset: int = 0,
    page: int | None = None,
    page_count: int | None = None,
) -> dict:
    """Pure: assemble everything the template needs.

    header keys: doc_no, doc_label, client_name, order_date, delivery_date,
                 dealt_with, status (all optional except doc_label).
    item keys:   description, product_name, dimensions, qty, unit, the SPEC_LABELS
                 columns, spec_notes, photo_data_uri.

    `sr_offset` keeps Sr. numbers continuous across paginated images — page 2 of a
    12-item card must start at 7, not restart at 1, or the workshop cannot tell the
    pages apart or spot a missing one.
    """
    rows = [
        {
            "sr": sr_offset + i + 1,
            "size": (it.get("dimensions") or "").strip() or "—",
            "photo": it.get("photo_data_uri"),
            # PRODUCT is the short catalog name when we have one; the free-text
            # description is the fallback so a custom piece is never a blank cell.
            "product": (it.get("product_name") or it.get("description") or "").strip(),
            "qty": _qty(it.get("qty")),
            "unit": (it.get("unit") or "").strip(),
            "description_groups": build_description_block(it),
        }
        for i, it in enumerate(items)
    ]

    return {
        "seller": {**SELLER_DEFAULTS, **(seller or {})},
        "doc_label": header.get("doc_label") or "JOB CARD",
        "doc_no": header.get("doc_no") or "—",
        "client_name": header.get("client_name") or "—",
        "order_date": _fmt_date(header.get("order_date")),
        "delivery_date": _fmt_date(header.get("delivery_date")),
        "dealt_with": header.get("dealt_with") or "—",
        "status": header.get("status") or "",
        "items": rows,
        "item_count": len(rows),
        # Only set when the card was split across images, so a single-page card
        # carries no confusing "1 of 1".
        "page_label": (
            f"{page} of {page_count}" if page and page_count and page_count > 1 else None
        ),
    }


def render_job_card_html(
    header: dict,
    items: list[dict],
    seller: dict | None = None,
    *,
    sr_offset: int = 0,
    page: int | None = None,
    page_count: int | None = None,
) -> str:
    """Render the job card HTML. Jinja2 imported lazily."""
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATE_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template(_TEMPLATE_NAME)
    return template.render(
        **build_job_card_context(
            header, items, seller, sr_offset=sr_offset, page=page, page_count=page_count
        )
    )
