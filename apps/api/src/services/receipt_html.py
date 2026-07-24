"""Payment receipt → branded HTML for the PDF. Context builder is pure; Jinja2
imported lazily inside render. Mirrors quote_html conventions."""

from pathlib import Path

from .num_words import amount_in_words
from .quote_html import SELLER_DEFAULTS, _fmt_date, _inr

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
_TEMPLATE_NAME = "receipt.html"


def build_receipt_context(payment: dict, order: dict, customer: dict, seller: dict | None = None) -> dict:
    """Pure: display values for a receipt from payment/order/customer dicts."""
    return {
        "seller": {**SELLER_DEFAULTS, **(seller or {})},
        "receipt_no": payment["receipt_no"],
        "paid_at": _fmt_date(payment.get("paid_at")),
        "kind": payment["kind"],
        "mode": payment["mode"],
        "reference": payment.get("reference") or "",
        "amount": _inr(payment["amount"]),
        "amount_words": amount_in_words(payment["amount"]),
        "is_refund": payment["kind"] == "refund",
        "order_no": order["order_no"],
        "order_total": _inr(order["grand_total"]),
        "customer": {"name": customer.get("name") or "Customer", "phone": customer.get("phone") or ""},
    }


def render_receipt_html(payment: dict, order: dict, customer: dict, seller: dict | None = None) -> str:
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATE_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    return env.get_template(_TEMPLATE_NAME).render(
        **build_receipt_context(payment, order, customer, seller)
    )
