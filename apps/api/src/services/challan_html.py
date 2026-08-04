"""Delivery challan → HTML for the PDF, in TOPAZ'S OWN FORMAT (0037). PURE — no I/O.

Modelled directly on the client's paper challan (supplied 2026-08-04, sample "T.F 66").
Everything visual is here and in `templates/challan.html`.

─── WHAT THEIR FORMAT IS, AND WHAT IT IS NOT ─────────────────────────────────────
It is a HAND-OVER RECEIPT, not a tax document. That drives every decision below:

  * The item table has exactly TWO columns — `PRODUCT` and `RECEIVEd (✓ / X)`. There is
    no HSN column, no rate, no line amount and no GST block. The tick box is the point:
    the customer marks each piece as it comes off the tempo and signs once at the bottom.
    So `services/gst.py` is deliberately NOT used here — an earlier draft of this module
    computed CGST/SGST for the challan, and that was wrong for this document.
  * It DOES carry money, but only two figures: `Delivery rent` and `Balance Amount`.
    Neither is a line price. The balance is what the driver may need to collect, which is
    exactly why it is on the paper the driver carries.
  * The customer-facing thank-you letter and both signature blocks are part of the
    document, not decoration — the signed copy is the proof of delivery.

─── THE DATA CONTRACT ────────────────────────────────────────────────────────────
`build_challan_context()` is the promise this module makes to its template:

    challan_no                  "T.F 66"
    challan_date                "06 / 08 / 2026" (their form is a  /  /  fill-in)
    customer{name, address, mobile}
    dp_code                     their "D.P – ASG" line, carried verbatim
    delivery{tempo_number, driver_name, driver_phone, delivery_rent, notes}
    items[]{sr, product}        `product` already includes "× 2" when qty > 1
    balance_due                 "31500/-"  (their formatting: plain digits, no ₹, "/-")
    seller{name, address_lines[]}

─── TWO THINGS TO CONFIRM WITH THE CLIENT ────────────────────────────────────────
  1. **"D.P – ASG"** — the meaning of D.P is not in any spec. Carried as an opaque
     free-text field (`deliveries.dp_code`) so it prints correctly whatever it means;
     rename the label once they say.
  2. **The footer address** on their challan is "Topaz Furniture & Decors,
     Udhna-Magdalla Road, Surat-395009", which does NOT match `SELLER_DEFAULTS`
     ("Bhatar Road, Surat, Gujarat") used by the quotation and receipt PDFs. Their paper
     is authoritative for the challan, so it is hardcoded below — but the QUOTE and
     RECEIPT addresses are probably also wrong and are outside this change.
"""

from decimal import Decimal

# Their footer, verbatim from the supplied challan. Deliberately NOT SELLER_DEFAULTS —
# see the module docstring: the two disagree and this document's own paper wins.
CHALLAN_SELLER = {
    "name": "Topaz Furniture & Decors",
    "address_lines": ["Udhna-Magdalla Road,", "Surat- 395009"],
    "letter_signoff": "Topaz Furniture",
}

# Fixed copy, transcribed from the client's challan. Kept as constants rather than inlined
# in the template so a wording change is a one-line diff against what they actually print.
BARRIER_NOTE = "Please hand-in the barrier of this challan"
RECEIPT_DECLARATION = "I have received furniture as per our placed order."
THANK_YOU_LETTER = (
    "We heartily congratulate you on and wish for the prosperity of your sweet home. "
    "We are highly obliged to render our service to you and have a great home feeling "
    "of happiness with the fact that our creation is now your assets. Thank you, for "
    "choosing the quality of TOPAZ FURNITURE and hope to serve you again."
)


def _money(value) -> str:
    """Their format: plain digits with a trailing '/-'. No ₹, no comma grouping.

    Taken from the sample ("Balance Amount :- 31500/-"). Not `quote_html._inr`, which
    groups and shows paise — this document does neither.
    """
    if value is None:
        return ""
    amount = Decimal(str(value))
    if amount <= 0:
        return "0/-"
    return f"{int(amount.quantize(Decimal('1')))}/-"


def _date(value) -> str:
    """Their form prints the date as `  /  / 2026`, so it renders as DD / MM / YYYY."""
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%d / %m / %Y")
    return str(value)


def _product_label(item: dict) -> str:
    """The PRODUCT cell.

    Their sample shows a bare description ("CENTER TABLE") because that line was a single
    piece. A run carrying two of something needs the count, or one tick box covers an
    unknown quantity — so a qty above 1 is appended.
    """
    description = str(item.get("description") or "Item")
    try:
        qty = Decimal(str(item.get("qty") or 1))
    except (ValueError, ArithmeticError):
        qty = Decimal(1)
    if qty > 1:
        # Trim a trailing ".00" — "× 2", never "× 2.00".
        as_int = qty.quantize(Decimal("1"))
        shown = as_int if as_int == qty else qty
        return f"{description} × {shown}"
    return description


def _orders_covered(items: list[dict]) -> list[str]:
    """The distinct order numbers on this challan, in the order the lines print. Pure.

    A CONSIGNMENT can span several of one customer's orders (0040): the Central Table off
    ORD-41 and the Sofa off ORD-58 on one lorry for one recipient is ONE challan and ONE
    signature. Deduplicated by first appearance rather than sorted, so the list reads in the
    same sequence as the table above it.
    """
    seen: list[str] = []
    for item in items:
        order_no = str(item.get("order_no") or "").strip()
        if order_no and order_no not in seen:
            seen.append(order_no)
    return seen


def build_challan_context(challan: dict) -> dict:
    """Pure: every display value the challan template needs."""
    customer = challan.get("customer") or {}
    delivery = challan.get("delivery") or {}
    items_in = list(challan.get("items") or [])
    orders = _orders_covered(items_in)
    # Their paper has no order column. So the order number rides as a sub-label under the
    # product, and ONLY when the challan actually covers more than one order — printing
    # "ORD-…" on every line of a single-order run is noise on a document a customer reads
    # at their front door, and their sample carries no such line.
    spans_multiple_orders = len(orders) > 1

    return {
        "seller": CHALLAN_SELLER,
        "challan_no": challan.get("challan_no") or "",
        "challan_date": _date(challan.get("challan_date")),
        "customer": {
            "name": customer.get("name") or "",
            "address": customer.get("address") or "",
            "mobile": customer.get("mobile") or "",
        },
        "dp_code": challan.get("dp_code") or "",
        "delivery": {
            "tempo_number": delivery.get("tempo_number") or "",
            "driver_name": delivery.get("driver_name") or "",
            "driver_phone": delivery.get("driver_phone") or "",
            "delivery_rent": _money(delivery.get("delivery_rent")),
            "notes": delivery.get("notes") or "",
        },
        "items": [
            {
                "sr": i + 1,
                "product": _product_label(item),
                "order_no": (
                    str(item.get("order_no") or "") if spans_multiple_orders else ""
                ),
            }
            for i, item in enumerate(items_in)
        ],
        "item_count": len(items_in),
        "orders": orders,
        "spans_multiple_orders": spans_multiple_orders,
        # Blank rather than "0/-" when unknown: their form leaves the line to be written
        # in by hand, and printing a figure we are not sure of on a document the driver
        # collects against is worse than printing nothing.
        "balance_due": _money(challan.get("balance_due")),
        "barrier_note": BARRIER_NOTE,
        "receipt_declaration": RECEIPT_DECLARATION,
        "thank_you_letter": THANK_YOU_LETTER,
    }


def render_challan_html(challan: dict) -> str:
    """Render the challan HTML. Jinja2 imported lazily (import-light packages rule)."""
    from pathlib import Path

    from jinja2 import Environment, FileSystemLoader, select_autoescape

    template_dir = Path(__file__).resolve().parent.parent / "templates"
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        # autoescape is not cosmetic: the customer name and address are user input and
        # this document is printed and handed over.
        autoescape=select_autoescape(["html"]),
    )
    return env.get_template("challan.html").render(**build_challan_context(challan))
