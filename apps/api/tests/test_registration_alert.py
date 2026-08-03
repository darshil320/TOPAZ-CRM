"""Pure tests for services/registration_alert.py."""

from src.services.registration_alert import new_customer_params


def test_named_params_shape():
    params = new_customer_params("priya sharma", "teak dining set")
    by_name = {p["parameter_name"]: p["text"] for p in params}
    assert by_name == {"customer_name": "Priya Sharma", "interest": "teak dining set"}
    assert all(p["type"] == "text" for p in params)


def test_missing_name_falls_back_to_generic_not_blank():
    params = new_customer_params(None, "sofa")
    by_name = {p["parameter_name"]: p["text"] for p in params}
    assert by_name["customer_name"] == "A New Customer"


def test_missing_interest_falls_back_to_not_specified_not_blank():
    params = new_customer_params("Ravi", None)
    by_name = {p["parameter_name"]: p["text"] for p in params}
    assert by_name["interest"] == "Not specified"
    assert by_name["interest"] != ""


def test_empty_string_interest_also_falls_back():
    """An empty string reaches the same fallback as None — a template param must
    never render as a blank line inside Meta's fixed wording."""
    params = new_customer_params("Ravi", "")
    by_name = {p["parameter_name"]: p["text"] for p in params}
    assert by_name["interest"] == "Not specified"
