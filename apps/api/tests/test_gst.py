"""GST golden cases — the money-correctness gate (PLAN.md decision 1 / module 01).

Every expected value is hand-computed. Runs with no DB or heavy deps installed.
"""
from decimal import Decimal

import pytest

from src.services.gst import (
    DocTotals,
    LineInput,
    compute_document,
    compute_line,
)


def D(x):
    return Decimal(str(x))


def L(qty, price, rate):
    return LineInput(qty=D(qty), unit_price=D(price), gst_rate=D(rate))


# ── compute_line: pre-tax rounding ──────────────────────────────────────────
def test_line_total_basic():
    assert compute_line(2, "500.00", 18).line_total == D("1000.00")


def test_line_total_rounds_half_up_999_995():
    # ₹999.995 → 1000.00 (half-up)
    assert compute_line(1, "999.995", 18).line_total == D("1000.00")


def test_line_total_qty_decimal_rounds():
    # 1.5 * 333.33 = 499.995 → 500.00
    assert compute_line("1.5", "333.33", 18).line_total == D("500.00")


def test_line_total_truncation_edge_down():
    # 1 * 100.004 → 100.00 (rounds down)
    assert compute_line(1, "100.004", 5).line_total == D("100.00")


# ── compute_document: single line ───────────────────────────────────────────
def test_single_line_18_intra_gj():
    t = compute_document([L(1, 1000, 18)], 0, "GJ", "GJ")
    assert (t.subtotal, t.taxable_value) == (D("1000.00"), D("1000.00"))
    assert (t.cgst, t.sgst, t.igst) == (D("90.00"), D("90.00"), D("0.00"))
    assert t.grand_total == D("1180.00")


def test_single_line_18_inter_state():
    t = compute_document([L(1, 1000, 18)], 0, "MH", "GJ")
    assert (t.cgst, t.sgst, t.igst) == (D("0.00"), D("0.00"), D("180.00"))
    assert t.grand_total == D("1180.00")


def test_place_equals_home_is_intra():
    t = compute_document([L(1, 1000, 18)], 0, "GJ", "GJ")
    assert t.igst == D("0.00") and t.cgst == D("90.00")


# ── mixed rates ─────────────────────────────────────────────────────────────
def test_mixed_18_and_5_intra():
    # L1 2*500=1000 @18 ; L2 1*2000=2000 @5
    t = compute_document([L(2, 500, 18), L(1, 2000, 5)], 0, "GJ", "GJ")
    assert t.subtotal == D("3000.00")
    assert (t.cgst, t.sgst) == (D("140.00"), D("140.00"))  # 90+50
    assert t.igst == D("0.00")
    assert t.grand_total == D("3280.00")


def test_mixed_18_and_5_inter():
    t = compute_document([L(2, 500, 18), L(1, 2000, 5)], 0, "MH", "GJ")
    assert t.igst == D("280.00")  # 180 + 100
    assert t.grand_total == D("3280.00")


# ── discount pro-rating ─────────────────────────────────────────────────────
def test_discount_same_rate_intra():
    # L1 1000, L2 3000 @18 ; discount 400 → taxable 3600, tax 648
    t = compute_document([L(1, 1000, 18), L(1, 3000, 18)], 400, "GJ", "GJ")
    assert t.discount_amount == D("400.00")
    assert t.taxable_value == D("3600.00")
    assert (t.cgst, t.sgst) == (D("324.00"), D("324.00"))
    assert t.grand_total == D("4248.00")


def test_discount_prorated_across_mixed_rates_intra():
    # L1 1000@18, L2 1000@5 ; discount 200 → each taxable 900
    # tax: 900*18%=162, 900*5%=45 → total 207 → cgst/sgst 103.50 each
    t = compute_document([L(1, 1000, 18), L(1, 1000, 5)], 200, "GJ", "GJ")
    assert t.taxable_value == D("1800.00")
    assert (t.cgst, t.sgst) == (D("103.50"), D("103.50"))
    assert t.grand_total == D("2007.00")


def test_discount_prorated_three_lines_sixths():
    # 1000@18, 2000@18, 3000@5 ; subtotal 6000, discount 600 (shares 1/6,2/6,3/6)
    # taxable lines 900,1800,2700 → 18%:2700→486 (cgst243); 5%:2700→135 (cgst67.5)
    t = compute_document([L(1, 1000, 18), L(1, 2000, 18), L(1, 3000, 5)], 600, "GJ", "GJ")
    assert t.taxable_value == D("5400.00")
    assert (t.cgst, t.sgst) == (D("310.50"), D("310.50"))
    assert t.grand_total == D("6021.00")


def test_discount_full_subtotal_zeroes_tax():
    t = compute_document([L(1, 3000, 18)], 3000, "GJ", "GJ")
    assert t.taxable_value == D("0.00")
    assert (t.cgst, t.sgst, t.igst) == (D("0.00"), D("0.00"), D("0.00"))
    assert t.grand_total == D("0.00")


def test_discount_over_subtotal_is_clamped():
    t = compute_document([L(1, 3000, 18)], 5000, "GJ", "GJ")
    assert t.discount_amount == D("3000.00")
    assert t.taxable_value == D("0.00")
    assert t.grand_total == D("0.00")


def test_negative_discount_raises():
    with pytest.raises(ValueError):
        compute_document([L(1, 1000, 18)], -1, "GJ", "GJ")


# ── rounding at document level ──────────────────────────────────────────────
def test_document_tax_rounds_half_up():
    # 999 @5 intra → 49.95 total, half 24.975 → cgst/sgst 24.98 each
    t = compute_document([L(1, 999, 5)], 0, "GJ", "GJ")
    assert (t.cgst, t.sgst) == (D("24.98"), D("24.98"))
    assert t.grand_total == D("1048.96")


def test_zero_rate_line():
    t = compute_document([L(1, 500, 0)], 0, "GJ", "GJ")
    assert (t.cgst, t.sgst, t.igst) == (D("0.00"), D("0.00"), D("0.00"))
    assert t.grand_total == D("500.00")


def test_zero_rate_mixed_with_taxed_line():
    # 500@0 + 1000@18 intra → tax only on second line
    t = compute_document([L(1, 500, 0), L(1, 1000, 18)], 0, "GJ", "GJ")
    assert t.subtotal == D("1500.00")
    assert (t.cgst, t.sgst) == (D("90.00"), D("90.00"))
    assert t.grand_total == D("1680.00")


def test_qty_decimals_intra():
    # 2.5 * 400 = 1000 @18 intra
    t = compute_document([L("2.5", 400, 18)], 0, "GJ", "GJ")
    assert t.subtotal == D("1000.00")
    assert t.grand_total == D("1180.00")


def test_line_totals_rounded_before_subtotal():
    # 3 lines of 33.33 → each 33.33, subtotal 99.99 (not 100)
    t = compute_document([L(1, "33.33", 18), L(1, "33.33", 18), L(1, "33.33", 18)], 0, "GJ", "GJ")
    assert t.subtotal == D("99.99")


def test_empty_document_is_zero():
    t = compute_document([], 0, "GJ", "GJ")
    assert t == DocTotals(
        subtotal=D("0.00"), discount_amount=D("0.00"), taxable_value=D("0.00"),
        cgst=D("0.00"), sgst=D("0.00"), igst=D("0.00"), grand_total=D("0.00"),
    )


def test_all_money_fields_are_two_dp():
    t = compute_document([L(3, "111.11", 12), L(2, "77.77", 5)], "50", "MH", "GJ")
    for v in (t.subtotal, t.discount_amount, t.taxable_value, t.cgst, t.sgst, t.igst, t.grand_total):
        assert v == v.quantize(Decimal("0.01"))


def test_grand_total_identity_intra():
    # grand_total must equal taxable + cgst + sgst + igst exactly
    t = compute_document([L(2, "1234.56", 18), L(1, "789.10", 5)], "100", "GJ", "GJ")
    assert t.grand_total == t.taxable_value + t.cgst + t.sgst + t.igst


def test_grand_total_identity_inter():
    t = compute_document([L(2, "1234.56", 18), L(1, "789.10", 5)], "100", "KA", "GJ")
    assert t.grand_total == t.taxable_value + t.cgst + t.sgst + t.igst
    assert t.cgst == Decimal("0.00") and t.sgst == Decimal("0.00")
