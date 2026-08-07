"""Delivery challan → HTML for the PDF, in TOPAZ'S OWN FORMAT. PURE — no I/O.

Modelled directly on the client's updated paper challan format (sample "T.F 4").
Everything visual is here and in `templates/challan.html`.

─── WHAT THEIR FORMAT IS, AND WHAT IT IS NOT ─────────────────────────────────────
It is a HAND-OVER RECEIPT, not a tax document. That drives every decision below:

  * The item table has four columns — `SR`, `PRODUCT DESCRIPTION`, `QTY`, and `RECEIVED`.
    There is no HSN column, no rate, no line amount and no GST block. The checkbox is the point:
    the customer marks each piece as it comes off the tempo and signs once at the bottom.
  * It DOES carry money: `Delivery Charges` and `BALANCE PAYABLE`.
    Neither is a line price. The balance payable is what the driver may need to collect,
    which is why it is on the paper the driver carries.
  * The customer-facing declaration, thank-you note, and signature blocks are part of the
    document — the signed copy is proof of delivery.

─── THE DATA CONTRACT ────────────────────────────────────────────────────────────
`build_challan_context()` is the promise this module makes to its template:

    challan_no                  "T.F 4"
    challan_date                "07 / 08 / 2026"
    customer{name, address, mobile}
    dp_code                     their "DESIGN PARTNER" line, carried verbatim
    delivery{tempo_number, driver_name, driver_phone, delivery_rent, notes}
    items[]{sr, product, qty, order_no}
    balance_due                 "₹ 30,000"
    seller{name, address_lines[], phone, email, gstin}
"""

from decimal import Decimal

CHALLAN_SELLER = {
    "name": "Topaz Furniture & Decors",
    "address_lines": ["Udhna – Magdalla Road, Surat – 395009, Gujarat"],
    "phone": "+91 00000 00000",
    "email": "care@topazfurniture.in",
    "gstin": "24XXXXXXXXXXXZX",
    "letter_signoff": "Topaz Furniture",
}

BARRIER_NOTE = "Please hand-in the barrier of this challan"
RECEIPT_DECLARATION = (
    "I confirm that the goods listed above have been received in full, in good condition and as per the order placed."
)
THANK_YOU_LETTER = (
    "Congratulations on your new home. It is a privilege to have our work become part of it, and we hope it brings you many years of comfort. Thank you for choosing Topaz Furniture."
)


def _money(value) -> str:
    """Format currency in INR: '₹ 30,000' or '₹ 500'. Blank string if None."""
    if value is None:
        return ""
    try:
        amount = Decimal(str(value))
    except (ValueError, ArithmeticError):
        return ""
    if amount <= 0:
        return "₹ 0"
    as_int = int(amount.quantize(Decimal("1")))
    return f"₹ {as_int:,}"


def _date(value) -> str:
    """Renders date as DD / MM / YYYY."""
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%d / %m / %Y")
    return str(value)


def _qty_label(item: dict) -> str:
    """Format item quantity for the QTY column."""
    try:
        qty = Decimal(str(item.get("qty") or 1))
    except (ValueError, ArithmeticError):
        return "1"
    as_int = qty.quantize(Decimal("1"))
    return str(as_int) if as_int == qty else str(qty)


def _orders_covered(items: list[dict]) -> list[str]:
    """The distinct order numbers on this challan, in the order the lines print."""
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
    spans_multiple_orders = len(orders) > 1

    processed_items = []
    for i, item in enumerate(items_in):
        processed_items.append(
            {
                "sr": f"{i + 1:02d}",
                "product": str(item.get("description") or "Item"),
                "qty": _qty_label(item),
                "order_no": (
                    str(item.get("order_no") or "") if spans_multiple_orders else ""
                ),
            }
        )

    # Pad table rows up to at least 6 rows to maintain pre-printed grid appearance
    padded_items = list(processed_items)
    for i in range(len(processed_items), 6):
        padded_items.append(
            {
                "sr": f"{i + 1:02d}",
                "product": "",
                "qty": "",
                "order_no": "",
                "is_placeholder": True,
            }
        )

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
        "items": padded_items,
        "item_count": len(items_in),
        "orders": orders,
        "spans_multiple_orders": spans_multiple_orders,
        "balance_due": _money(challan.get("balance_due")),
        "barrier_note": BARRIER_NOTE,
        "receipt_declaration": RECEIPT_DECLARATION,
        "thank_you_letter": THANK_YOU_LETTER,
    }


def render_challan_html(challan: dict) -> str:
    """Render the challan HTML."""
    from pathlib import Path

    from jinja2 import Environment, FileSystemLoader, select_autoescape

    template_dir = Path(__file__).resolve().parent.parent / "templates"
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=select_autoescape(["html"]),
    )
    return env.get_template("challan.html").render(**build_challan_context(challan))
