"""Product QR code rules — pure, no DB."""
import pytest
from src.services import product_codes as pc


@pytest.mark.parametrize("raw, expected", [
    ("7K3M9QXA", "7K3M9QXA"),
    ("7k3m9qxa", "7K3M9QXA"),             # lowercase from a hand-typed lookup
    (" 7K3M-9QXA ", "7K3M9QXA"),          # read aloud in two halves
    ("7K3M 9QXA", "7K3M9QXA"),
    ("OK3M9QXA", "0K3M9QXA"),             # O misread for zero
    ("7K3MIQXA", "7K3M1QXA"),             # I misread for one
    ("7K3MLQXA", "7K3M1QXA"),             # L misread for one
])
def test_normalize_accepts_and_canonicalises(raw, expected):
    assert pc.normalize_code(raw) == expected


@pytest.mark.parametrize("raw", [
    None, 12345678, "", "7K3M9QX", "7K3M9QXAB", "7K3M9QXU",   # U is not Crockford
    "7K3M9QX!", "../../etc", "7K3M9QXA' or 1=1", "x" * 1000,
])
def test_normalize_rejects_anything_that_is_not_a_code(raw):
    assert pc.normalize_code(raw) is None


def test_base_url_defaults_to_the_dashboard_p_route():
    assert pc.qr_base_url(None, "https://topaz.dmcdigital.in/") == "https://topaz.dmcdigital.in/p"


def test_explicit_base_url_wins_and_is_trimmed():
    assert pc.qr_base_url("https://tpz.in/p/", "https://ignored") == "https://tpz.in/p"


def test_product_url_joins_cleanly():
    assert pc.product_url("https://tpz.in/p/", "7K3M9QXA") == "https://tpz.in/p/7K3M9QXA"
