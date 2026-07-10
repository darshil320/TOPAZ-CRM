"""Follow-up message templates — local render + Meta template-name mapping.

Two send paths share these entries (§ WhatsApp 24h rule):
  - Inside the 24h customer-service window → free-form text, rendered locally
    from `body` via render_followup().
  - Outside the window → Meta template send; `meta_template` is the template
    name registered in WhatsApp Manager. The registered templates use NAMED
    parameters ({{customer_name}}, {{advisor_name}}), so `meta_params` maps
    each Meta parameter_name to its template_vars key, in template order.
"""

from dataclasses import dataclass


class _SafeDict(dict):
    """format_map helper — leaves unknown placeholders blank instead of raising."""

    def __missing__(self, key: str) -> str:
        return ""


@dataclass(frozen=True)
class FollowupTemplate:
    body: str
    meta_template: str
    # (Meta parameter_name, template_vars key) pairs, in body order.
    meta_params: tuple[tuple[str, str], ...]


FOLLOWUP_TEMPLATES: dict[str, FollowupTemplate] = {
    "welcome_visit": FollowupTemplate(
        body=(
            "Hi {name}, thank you for visiting Topaz Furniture today! "
            "It was a pleasure having you at our showroom. "
            "Your advisor {advisor_name} will assist you personally. "
            "If anything caught your eye — or you'd like photos, prices, or a "
            "custom option — just reply here and we'll help right away. 🛋️\n\n"
            "— Team Topaz Furniture"
        ),
        meta_template="topaz_welcome",
        meta_params=(("customer_name", "name"), ("advisor_name", "advisor_name")),
    ),
    "topaz_followup": FollowupTemplate(
        body=(
            "Hi {name}, this is Team Topaz Furniture following up on your "
            "recent showroom visit. Is there a piece you're still considering? "
            "Reply here and we'll share details, pricing, or set up a quick "
            "call — whatever works for you.\n\n"
            "— Team Topaz Furniture"
        ),
        meta_template="topaz_followup",
        meta_params=(("customer_name", "name"),),
    ),
}

_DEFAULT_NAME = "there"

# Per-key fallback when a var is missing (e.g. customer not yet claimed by a
# primary salesperson at send-time). The advisor fallback is phrased so the
# fixed sentence "Your advisor X will assist you personally." stays grammatical.
_DEFAULT_PARAM_VALUES = {"name": _DEFAULT_NAME, "advisor_name": "at Topaz Furniture"}


def _with_defaults(template_vars: dict) -> dict:
    """Return a copy of template_vars with falsy known keys replaced by defaults."""
    variables = dict(template_vars)
    for key, default in _DEFAULT_PARAM_VALUES.items():
        if not variables.get(key):
            variables[key] = default
    return variables


def render_followup(template_name: str, template_vars: dict) -> str:
    """Render the free-form body for a followup; raises KeyError on unknown template."""
    template = FOLLOWUP_TEMPLATES[template_name]
    return template.body.format_map(_SafeDict(_with_defaults(template_vars)))


def meta_template_params(template_name: str, template_vars: dict) -> tuple[str, list[dict]]:
    """Return (meta_template_name, named body parameters) for a template send.

    Parameters are Cloud API body-component objects with `parameter_name` set —
    the registered templates use NAMED parameter format, not positional.
    """
    template = FOLLOWUP_TEMPLATES[template_name]
    variables = _with_defaults(template_vars)
    params = [
        {"type": "text", "parameter_name": meta_name, "text": str(variables.get(var_key, ""))}
        for meta_name, var_key in template.meta_params
    ]
    return template.meta_template, params
