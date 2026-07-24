"""Indian-system amount-in-words for invoices/quotes. Pure, no deps, no I/O.

Renders a rupee amount as words using the lakh/crore grouping, e.g.
  126789.50 -> "Rupees One Lakh Twenty Six Thousand Seven Hundred Eighty Nine
                and Fifty Paise Only"
Used on the quotation/receipt PDF (a GST-invoice convention). Decimal in,
str out; rounds to 2dp half-up (matches gst.py money rounding).
"""

from decimal import Decimal, ROUND_HALF_UP

_ONES = (
    "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
)
_TENS = ("", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety")


def _two_digits(n: int) -> str:
    if n < 20:
        return _ONES[n]
    tens, ones = divmod(n, 10)
    return _TENS[tens] + (f" {_ONES[ones]}" if ones else "")


def _three_digits(n: int) -> str:
    """0..999 in words (no leading 'and')."""
    hundreds, rest = divmod(n, 100)
    parts = []
    if hundreds:
        parts.append(f"{_ONES[hundreds]} Hundred")
    if rest:
        parts.append(_two_digits(rest))
    return " ".join(parts)


def _whole_in_words(n: int) -> str:
    """A non-negative integer in the Indian lakh/crore system."""
    if n == 0:
        return "Zero"
    crore, n = divmod(n, 10_000_000)
    lakh, n = divmod(n, 100_000)
    thousand, n = divmod(n, 1_000)
    hundred = n

    parts = []
    if crore:
        parts.append(f"{_whole_in_words(crore)} Crore")
    if lakh:
        parts.append(f"{_two_digits(lakh)} Lakh")
    if thousand:
        parts.append(f"{_two_digits(thousand)} Thousand")
    if hundred:
        parts.append(_three_digits(hundred))
    return " ".join(parts)


def amount_in_words(amount, currency: str = "Rupees", subunit: str = "Paise") -> str:
    """Render a money amount as an Indian-format words string ending in 'Only'."""
    value = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if value < 0:
        return f"Minus {amount_in_words(-value, currency, subunit)}"
    rupees = int(value)
    paise = int((value - rupees) * 100)

    words = f"{currency} {_whole_in_words(rupees)}"
    if paise:
        words += f" and {_two_digits(paise)} {subunit}"
    return f"{words} Only"
