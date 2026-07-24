"""Amount-in-words (Indian lakh/crore system). Pure, no deps."""
from decimal import Decimal

from src.services.num_words import amount_in_words


def test_zero():
    assert amount_in_words(0) == "Rupees Zero Only"


def test_simple_hundreds():
    assert amount_in_words(Decimal("500.00")) == "Rupees Five Hundred Only"


def test_paise():
    assert amount_in_words(Decimal("126789.50")) == (
        "Rupees One Lakh Twenty Six Thousand Seven Hundred Eighty Nine and Fifty Paise Only"
    )


def test_grand_total_golden():
    # gst golden #1 grand total
    assert amount_in_words(Decimal("3780.00")) == "Rupees Three Thousand Seven Hundred Eighty Only"


def test_crore():
    assert amount_in_words(Decimal("12345678.00")) == (
        "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only"
    )


def test_half_up_rounding():
    # 999.995 -> 1000.00 (half-up), so no paise
    assert amount_in_words(Decimal("999.995")) == "Rupees One Thousand Only"


def test_only_paise():
    assert amount_in_words(Decimal("0.75")) == "Rupees Zero and Seventy Five Paise Only"
