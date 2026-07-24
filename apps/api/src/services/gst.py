"""GST computation — pure functions, Decimal only (PLAN.md decision 1).

Money rules, enforced here and nowhere else:
  - All arithmetic in Decimal; never float.
  - Per-line pre-tax total (qty * unit_price) is rounded to 2dp — that is the value
    shown on each invoice line.
  - A document-level discount (absolute amount) is pro-rated across lines by their
    pre-tax share, at full precision (no per-line rounding of the discount).
  - Tax is accumulated at full precision, then each of CGST/SGST/IGST is rounded
    half-up to 2dp AT THE DOCUMENT LEVEL (not per line).
  - Intra-state (place_of_supply == home_state) → CGST + SGST, each rate/2.
    Inter-state → IGST at the full rate. place_of_supply drives the split.

No I/O, no DB, no config reads — callers pass home_state in. Fully unit-testable
without any dependency installed.
"""

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable

_CENT = Decimal("0.01")
_HUNDRED = Decimal("100")


def _money(value) -> Decimal:
    """Round any Decimal-coercible value to 2dp, half-up."""
    return Decimal(value).quantize(_CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class LineInput:
    """One quote/order line before tax. gst_rate is a percentage (e.g. 18 for 18%)."""
    qty: Decimal
    unit_price: Decimal
    gst_rate: Decimal


@dataclass(frozen=True)
class LineTax:
    line_total: Decimal  # qty * unit_price, rounded to 2dp (pre-tax)


@dataclass(frozen=True)
class DocTotals:
    subtotal: Decimal
    discount_amount: Decimal
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    grand_total: Decimal


def compute_line(qty, unit_price, gst_rate=0) -> LineTax:
    """Pre-tax line total = qty * unit_price, rounded to 2dp. gst_rate is accepted
    for signature symmetry but tax is only computed at the document level."""
    return LineTax(line_total=_money(Decimal(str(qty)) * Decimal(str(unit_price))))


def _d(value) -> Decimal:
    return Decimal(str(value))


def compute_document(
    lines: Iterable[LineInput],
    discount=0,
    place_of_supply: str = "GJ",
    home_state: str = "GJ",
) -> DocTotals:
    """Compute a document's tax totals from its lines and an absolute discount.

    Raises ValueError on a negative discount. A discount larger than the subtotal
    is clamped to the subtotal (taxable_value floors at 0)."""
    lines = list(lines)
    discount = _d(discount)
    if discount < 0:
        raise ValueError("discount cannot be negative")

    # Per-line pre-tax totals (each rounded to 2dp) and the subtotal.
    line_totals = [_money(_d(ln.qty) * _d(ln.unit_price)) for ln in lines]
    subtotal = _money(sum(line_totals, Decimal(0)))

    discount = min(discount, subtotal)
    taxable_value = _money(subtotal - discount)

    intra = place_of_supply == home_state
    cgst_acc = sgst_acc = igst_acc = Decimal(0)

    for ln, lt in zip(lines, line_totals):
        # Pro-rate the discount by this line's pre-tax share (full precision).
        share = (lt / subtotal) if subtotal else Decimal(0)
        taxable_line = lt - discount * share
        rate = _d(ln.gst_rate) / _HUNDRED
        if intra:
            half = rate / 2
            cgst_acc += taxable_line * half
            sgst_acc += taxable_line * half
        else:
            igst_acc += taxable_line * rate

    cgst = _money(cgst_acc)
    sgst = _money(sgst_acc)
    igst = _money(igst_acc)
    grand_total = _money(taxable_value + cgst + sgst + igst)

    return DocTotals(
        subtotal=subtotal,
        discount_amount=_money(discount),
        taxable_value=taxable_value,
        cgst=cgst,
        sgst=sgst,
        igst=igst,
        grand_total=grand_total,
    )
