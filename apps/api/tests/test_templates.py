"""Unit tests for followup template rendering (no DB required)."""
import pytest

from src.services.templates import (
    FOLLOWUP_TEMPLATES,
    meta_template_params,
    render_followup,
)


def test_render_with_name():
    body = render_followup("welcome_visit", {"name": "Hemant"})
    assert "Hi Hemant," in body
    assert "{" not in body  # every placeholder resolved


def test_render_without_name_uses_default():
    body = render_followup("welcome_visit", {})
    assert "Hi there," in body


def test_render_empty_name_uses_default():
    body = render_followup("welcome_visit", {"name": ""})
    assert "Hi there," in body


def test_render_unknown_template_raises():
    with pytest.raises(KeyError):
        render_followup("nonexistent_template", {})


def test_render_ignores_unknown_placeholder_vars():
    body = render_followup("topaz_followup", {"name": "Asha", "rogue": "x"})
    assert "Hi Asha," in body


def test_meta_template_params_ordering():
    name, params = meta_template_params("welcome_visit", {"name": "Hemant"})
    assert name == "topaz_welcome"
    assert params == ["Hemant"]


def test_meta_template_params_default_name():
    _, params = meta_template_params("welcome_visit", {})
    assert params == ["there"]


def test_all_templates_render_cleanly():
    for template_name in FOLLOWUP_TEMPLATES:
        body = render_followup(template_name, {"name": "Test"})
        assert body.strip(), f"{template_name} rendered empty"
        assert "Topaz" in body
