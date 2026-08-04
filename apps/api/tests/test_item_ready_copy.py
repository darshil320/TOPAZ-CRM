"""Pure tests for the item-ready message copy (REQ 6, migration 0038).

The send path itself is DB + network and is integration-tested; what is unit-testable —
and what a customer-facing rupee figure absolutely must be — is the formatting.
"""

from src.services import transit_messages as tm


def test_indian_digit_grouping_not_western():
    # 3,3,3 grouping would render this as ₹125,000, which reads wrong in Surat.
    assert tm.format_inr(125000) == "₹1,25,000"
    assert tm.format_inr(1234567) == "₹12,34,567"
    assert tm.format_inr(9999) == "₹9,999"
    assert tm.format_inr(100) == "₹100"


def test_zero_and_negative_balances_read_as_paid():
    # A negative balance is an overpayment; telling the salesperson to collect
    # "₹-500" would be worse than telling them it is settled.
    assert tm.format_inr(0) == "Fully paid"
    assert tm.format_inr(-500) == "Fully paid"


def test_unknown_balance_falls_back_to_the_filler_not_zero():
    # Meta renders an empty parameter as a blank line; claiming ₹0 would be a lie.
    assert tm.format_inr(None) == tm._EMPTY


def test_paise_are_rounded_not_truncated():
    assert tm.format_inr(1250.60) == "₹1,251"


def test_item_ready_params_are_named_and_ordered():
    params = tm.item_ready_params(
        order_no="ORD-2026-0041",
        item_description="3-seater sofa, teak",
        customer_name="Hemant Patel",
        balance_due=125000,
    )
    assert [p["parameter_name"] for p in params] == [
        "order_no", "item_description", "customer_name", "balance_due",
    ]
    assert params[-1]["text"] == "₹1,25,000"
    # Meta rejects an empty parameter — every one must carry text.
    assert all(p["text"] for p in params)


def test_item_ready_template_name_is_the_registered_one():
    assert tm.TEMPLATE_ITEM_READY == "topaz_item_ready"
