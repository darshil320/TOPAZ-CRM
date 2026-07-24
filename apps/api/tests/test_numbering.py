"""Numbering — pure fiscal-year + format logic (no DB)."""
from datetime import date

from src.services.numbering import fiscal_year, format_number


def test_fiscal_year_after_april():
    assert fiscal_year(date(2026, 5, 1)) == "2627"
    assert fiscal_year(date(2026, 4, 1)) == "2627"


def test_fiscal_year_before_april():
    assert fiscal_year(date(2026, 2, 1)) == "2526"
    assert fiscal_year(date(2026, 3, 31)) == "2526"


def test_fiscal_year_jan_boundary():
    assert fiscal_year(date(2027, 1, 15)) == "2627"


def test_format_number_pads_to_four():
    assert format_number("QTN", "2627", 1) == "QTN-2627-0001"
    assert format_number("ORD", "2627", 42) == "ORD-2627-0042"
    assert format_number("RCP", "2627", 12345) == "RCP-2627-12345"
