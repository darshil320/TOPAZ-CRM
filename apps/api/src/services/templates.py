"""Follow-up message templates — local render + Meta template-name mapping.

Two send paths share these entries (§ WhatsApp 24h rule):
  - Inside the 24h customer-service window → free-form text, rendered locally
    from `body` via render_followup().
  - Outside the window → Meta template send; `meta_template` is the template
    name registered in WhatsApp Manager and `param_keys` defines the ordered
    positional {{1}}, {{2}}… substitutions taken from template_vars.
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
    param_keys: tuple[str, ...]


FOLLOWUP_TEMPLATES: dict[str, FollowupTemplate] = {
    "welcome_visit": FollowupTemplate(
        body=(
            "Hi {name}, thank you for visiting Topaz Furniture today! "
            "It was a pleasure having you at our showroom. "
            "If anything caught your eye — or you'd like photos, prices, or a "
            "custom option — just reply here and we'll help right away. 🛋️\n\n"
            "— Team Topaz Furniture"
        ),
        meta_template="topaz_welcome",
        param_keys=("name",),
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
        param_keys=("name",),
    ),
}

_DEFAULT_NAME = "there"


def render_followup(template_name: str, template_vars: dict) -> str:
    """Render the free-form body for a followup; raises KeyError on unknown template."""
    template = FOLLOWUP_TEMPLATES[template_name]
    variables = dict(template_vars)
    if not variables.get("name"):
        variables["name"] = _DEFAULT_NAME
    return template.body.format_map(_SafeDict(variables))


def meta_template_params(template_name: str, template_vars: dict) -> tuple[str, list[str]]:
    """Return (meta_template_name, ordered positional params) for a template send."""
    template = FOLLOWUP_TEMPLATES[template_name]
    params = [str(template_vars.get(key) or _DEFAULT_NAME) for key in template.param_keys]
    return template.meta_template, params
