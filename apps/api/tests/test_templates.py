"""Unit tests for followup template rendering (no DB required)."""
import pytest

from src.services.templates import (
    FOLLOWUP_TEMPLATES,
    meta_template_params,
    missing_params,
    render_followup,
    welcome_template_key,
)

# What tasks/followup.py passes as `defaults` — the showroom's own number, standing in
# for an advisor the customer has not been assigned yet. Every welcome render goes
# through this, because Meta rejects a template send with an empty parameter.
SHOWROOM = {"advisor_phone": "+91 63563 20206"}


def test_render_with_name():
    body = render_followup("welcome_visit", {"name": "Hemant"}, SHOWROOM)
    assert "Hi Hemant," in body
    assert "{" not in body  # every placeholder resolved


def test_render_without_name_uses_default():
    body = render_followup("welcome_visit", {}, SHOWROOM)
    assert "Hi there," in body


def test_render_empty_name_uses_default():
    body = render_followup("welcome_visit", {"name": ""}, SHOWROOM)
    assert "Hi there," in body


def test_render_welcome_includes_advisor():
    body = render_followup(
        "welcome_visit", {"name": "Hemant", "advisor_name": "Ramesh"}, SHOWROOM
    )
    assert "Your advisor Ramesh" in body


def test_render_welcome_advisor_fallback_reads_naturally():
    body = render_followup("welcome_visit", {"name": "Hemant"}, SHOWROOM)
    assert "Your advisor at Topaz Furniture" in body
    assert "{" not in body


def test_render_unknown_template_raises():
    with pytest.raises(KeyError):
        render_followup("nonexistent_template", {})


def test_render_ignores_unknown_placeholder_vars():
    body = render_followup("topaz_followup", {"name": "Asha", "rogue": "x"})
    assert "Hi Asha," in body


def test_meta_template_params_named_ordering():
    name, params = meta_template_params(
        "welcome_visit", {"name": "Hemant", "advisor_name": "Ramesh"}
    )
    assert name == "topaz_welcome"
    assert params == [
        {"type": "text", "parameter_name": "customer_name", "text": "Hemant"},
        {"type": "text", "parameter_name": "advisor_name", "text": "Ramesh"},
    ]


def test_meta_template_params_defaults():
    _, params = meta_template_params("welcome_visit", {})
    assert params == [
        {"type": "text", "parameter_name": "customer_name", "text": "there"},
        {"type": "text", "parameter_name": "advisor_name", "text": "at Topaz Furniture"},
    ]


def test_meta_template_params_followup_single_param():
    name, params = meta_template_params("topaz_followup", {"name": "Asha"})
    assert name == "topaz_followup"
    assert params == [{"type": "text", "parameter_name": "customer_name", "text": "Asha"}]


def test_all_templates_render_cleanly():
    for template_name in FOLLOWUP_TEMPLATES:
        body = render_followup(template_name, {"name": "Test"}, SHOWROOM)
        assert body.strip(), f"{template_name} rendered empty"
        assert "Topaz" in body


# ─── REQ 1: the advisor's phone number ───────────────────────────────────────
def test_free_form_welcome_carries_the_advisor_number_today():
    """The in-window path needs no Meta approval, so it ships immediately."""
    body = render_followup(
        "welcome_visit",
        {"name": "Hemant", "advisor_name": "Ramesh", "advisor_phone": "+91 98250 11111"},
        SHOWROOM,
    )
    assert "Your advisor Ramesh (+91 98250 11111) will assist you personally." in body


def test_free_form_v2_body_is_identical_to_v1():
    """Only the Meta template differs; the free-form copy must not drift between them."""
    variables = {"name": "Hemant", "advisor_name": "Ramesh", "advisor_phone": "+91 98250 11111"}
    assert render_followup("welcome_visit", variables, SHOWROOM) == render_followup(
        "welcome_visit_v2", variables, SHOWROOM
    )


def test_unclaimed_customer_falls_back_to_the_showroom_number():
    body = render_followup("welcome_visit", {"name": "Hemant"}, SHOWROOM)
    assert "+91 63563 20206" in body
    # …and never an empty parenthetical.
    assert "()" not in body


def test_v2_sends_three_named_params_in_body_order():
    name, params = meta_template_params(
        "welcome_visit_v2",
        {"name": "Hemant", "advisor_name": "Ramesh", "advisor_phone": "+91 98250 11111"},
        SHOWROOM,
    )
    assert name == "topaz_welcome_v2"
    assert params == [
        {"type": "text", "parameter_name": "customer_name", "text": "Hemant"},
        {"type": "text", "parameter_name": "advisor_name", "text": "Ramesh"},
        {"type": "text", "parameter_name": "advisor_phone", "text": "+91 98250 11111"},
    ]


def test_v2_unclaimed_customer_gets_the_showroom_number_not_a_blank():
    _, params = meta_template_params("welcome_visit_v2", {}, SHOWROOM)
    assert params[-1] == {
        "type": "text",
        "parameter_name": "advisor_phone",
        "text": "+91 63563 20206",
    }


def test_v1_never_sends_the_phone_param():
    """v1 is the APPROVED two-parameter template. A third parameter on it is a 400."""
    _, params = meta_template_params("welcome_visit", {"advisor_phone": "+91 1"}, SHOWROOM)
    assert [p["parameter_name"] for p in params] == ["customer_name", "advisor_name"]


def test_missing_params_catches_a_blank_before_meta_does():
    assert missing_params("welcome_visit_v2", {}, {}) == ("advisor_phone",)
    assert missing_params("welcome_visit_v2", {}, SHOWROOM) == ()


def test_missing_params_treats_whitespace_as_blank():
    assert missing_params("welcome_visit_v2", {"advisor_phone": "   "}, {}) == ("advisor_phone",)


def test_welcome_template_key_is_env_gated_both_ways():
    assert welcome_template_key(v2_enabled=False) == "welcome_visit"
    assert welcome_template_key(v2_enabled=True) == "welcome_visit_v2"
    # Both keys must exist, or a flag flip would KeyError at send time.
    assert "welcome_visit" in FOLLOWUP_TEMPLATES
    assert "welcome_visit_v2" in FOLLOWUP_TEMPLATES
