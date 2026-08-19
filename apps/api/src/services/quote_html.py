"""Quotation → branded HTML for the PDF. The context builder is pure and unit-
tested; Jinja2 is imported lazily inside the render function so the core suite
runs without the templating dep.
"""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from .num_words import amount_in_words

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
_TEMPLATE_NAME = "quotation.html"

# Topaz brand + seller identity. Kept here (not hardcoded in the template) so a
# single edit updates the document; real GSTIN/address land via app_settings (M06).
SELLER_DEFAULTS = {
    "name": "Topaz Furniture",
    "tagline": "Fine Furniture & Interiors",
    "address": "Bhatar Road, Surat, Gujarat",
    "phone": "",
    "gstin": "",
    "brand_color": "#B45309",  # amber-700
}


def _inr(value) -> str:
    """Format a number in the Indian grouping with 2dp, e.g. 126789.5 -> '1,26,789.50'."""
    d = Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sign = "-" if d < 0 else ""
    d = abs(d)
    whole, frac = divmod(int(d * 100), 100)
    s = str(whole)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        # group the head in 2s (Indian system)
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return f"{sign}{s}.{frac:02d}"


def _fmt_date(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, str):
        value = value[:10]
        return value
    if isinstance(value, date):
        return value.strftime("%d %b %Y")
    return str(value)


def build_quote_context(quote: dict, customer: dict, seller: dict | None = None) -> dict:
    """Pure: assemble every display value the template needs from a quote dict
    (quotation_repo.get_quotation shape) + customer dict."""
    home_state = "GJ"
    intra = quote.get("place_of_supply") == home_state

    items = [
        {
            "sr": i + 1,
            "description": it["description"],
            "specs": " · ".join(
                str(it[k]) for k in ("dimensions", "material", "fabric", "polish", "customization")
                if it.get(k)
            ),
            "hsn": it["hsn"],
            "qty": it["qty"],
            "unit": it.get("unit") or "",
            "gst_rate": it["gst_rate"],
            "unit_price": _inr(it["unit_price"]),
            "line_total": _inr(it["line_total"]),
            # Already-inlined data URI, or None. STILL PURE: the caller does the I/O
            # (tasks/pdf.py resolves the key and inlines the bytes), exactly as the job
            # card does — Playwright fetching a private-bucket URL mid-render is how
            # this renderer broke once before (STATE.md 2026-07-26, commit 0a43348).
            "photo": it.get("photo_data_uri"),
        }
        for i, it in enumerate(quote.get("items", []))
    ]

    return {
        "seller": {**SELLER_DEFAULTS, **(seller or {})},
        "quote_no": quote["quote_no"],
        "revision_no": quote.get("revision_no", 1),
        "status": quote.get("status", "draft"),
        "created_at": _fmt_date(quote.get("created_at")),
        "valid_until": _fmt_date(quote.get("valid_until")),
        "place_of_supply": quote.get("place_of_supply", home_state),
        "intra": intra,
        "customer": {
            "name": customer.get("name") or "Customer",
            "phone": customer.get("phone") or "",
        },
        "items": items,
        # Drives whether the Photo column is rendered at all. A quotation for which
        # nothing has been photographed should look like it always did, not grow an
        # empty column — the customer reads that as a document with missing pieces.
        "has_photos": any(it["photo"] for it in items),
        "subtotal": _inr(quote["subtotal"]),
        "discount_amount": _inr(quote["discount_amount"]),
        "has_discount": Decimal(str(quote.get("discount_amount") or 0)) > 0,
        "taxable_value": _inr(quote["taxable_value"]),
        "cgst": _inr(quote["cgst"]),
        "sgst": _inr(quote["sgst"]),
        "igst": _inr(quote["igst"]),
        "grand_total": _inr(quote["grand_total"]),
        "grand_total_words": amount_in_words(quote["grand_total"]),
        "terms": quote.get("terms") or "",
        "notes": quote.get("notes") or "",
    }


def render_quote_html(quote: dict, customer: dict, seller: dict | None = None) -> str:
    """Render the branded quotation HTML. Jinja2 imported lazily."""
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATE_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template(_TEMPLATE_NAME)
    return template.render(**build_quote_context(quote, customer, seller))
