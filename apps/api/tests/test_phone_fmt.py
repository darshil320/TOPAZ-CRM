"""Pure tests for services/phone_fmt.py — no DB, no network."""

from src.services import phone_fmt


def test_wa_id_form_becomes_readable():
    # What salespersons.whatsapp actually holds.
    assert phone_fmt.display("916356320206") == "+91 63563 20206"


def test_plus_prefixed_and_spaced_forms_normalise_the_same_way():
    for raw in ("+916356320206", "+91 63563 20206", "+91-63563-20206", "(91) 6356320206"):
        assert phone_fmt.display(raw) == "+91 63563 20206", raw


def test_bare_ten_digit_number_gets_the_country_code():
    assert phone_fmt.display("6356320206") == "+91 63563 20206"


def test_unrecognised_length_is_returned_untouched():
    # A landline with an STD code, or a typo. Mangling it would be worse than leaving it.
    assert phone_fmt.display("0261 2345678") == "0261 2345678"
    assert phone_fmt.display("12345") == "12345"


def test_blank_input_is_blank_output():
    assert phone_fmt.display(None) == ""
    assert phone_fmt.display("") == ""
    assert phone_fmt.display("   ") == ""


def test_e164_has_no_spaces():
    assert phone_fmt.to_e164_india("+91 63563 20206") == "+916356320206"
    assert phone_fmt.to_e164_india("6356320206") == "+916356320206"


def test_e164_refuses_to_guess():
    assert phone_fmt.to_e164_india("0261 2345678") == ""
    assert phone_fmt.to_e164_india(None) == ""


def test_twelve_digits_not_starting_with_91_is_not_indian():
    assert phone_fmt.to_e164_india("446356320206") == ""


def test_digits_only_strips_everything_else():
    assert phone_fmt.digits_only("+91 (635) 632-0206") == "916356320206"
