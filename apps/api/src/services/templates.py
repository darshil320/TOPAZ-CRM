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
    # "marketing" templates require whatsapp_marketing consent; "utility"
    # (transactional, e.g. payment due) bypass it — they still require a wa_id
    # and a non-withdrawn consent. See tasks/followup._skip_reason.
    category: str = "marketing"


"""The welcome body, shared by v1 and v2.

The ADVISOR'S NUMBER is in the free-form body of BOTH variants on purpose: inside the
24h window nothing needs Meta's approval, so the client's ask ships the day it is asked
for. Only the out-of-window path has to wait for `topaz_welcome_v2` to clear review, and
the variant split below exists purely to keep v1 sending in the meantime.
"""
_WELCOME_BODY = (
    "Hi {name}, thank you for visiting Topaz Furniture today! "
    "It was a pleasure having you at our showroom. "
    "Your advisor {advisor_name} ({advisor_phone}) will assist you personally. "
    "If anything caught your eye — or you'd like photos, prices, or a "
    "custom option — just reply here and we'll help right away. 🛋️\n\n"
    "— Team Topaz Furniture"
)

FOLLOWUP_TEMPLATES: dict[str, FollowupTemplate] = {
    "welcome_visit": FollowupTemplate(
        body=_WELCOME_BODY,
        meta_template="topaz_welcome",
        meta_params=(("customer_name", "name"), ("advisor_name", "advisor_name")),
    ),
    # v2 = v1 plus {{advisor_phone}}. A THIRD PARAMETER IS A TEMPLATE CHANGE, and editing
    # the live `topaz_welcome` puts it back In-Review — every out-of-window welcome would
    # fail for the 1–3 days Meta takes. So v2 is a separate submission, selected at SEND
    # time by welcome_template_key() once WELCOME_TEMPLATE_V2 is flipped on.
    "welcome_visit_v2": FollowupTemplate(
        body=_WELCOME_BODY,
        meta_template="topaz_welcome_v2",
        meta_params=(
            ("customer_name", "name"),
            ("advisor_name", "advisor_name"),
            ("advisor_phone", "advisor_phone"),
        ),
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
    "payment_due": FollowupTemplate(
        body=(
            "Hi {name}, a gentle reminder from Topaz Furniture: a payment of "
            "₹{amount} for order {order_no} is due on {due_date}. "
            "Reply here for payment options or any questions.\n\n"
            "— Team Topaz Furniture"
        ),
        meta_template="payment_due",
        meta_params=(
            ("customer_name", "name"),
            ("amount", "amount"),
            ("order_no", "order_no"),
            ("due_date", "due_date"),
        ),
        category="utility",  # transactional — bypasses marketing-consent gate
    ),
}

_DEFAULT_NAME = "there"

# Per-key fallback when a var is missing (e.g. customer not yet claimed by a
# primary salesperson at send-time). The advisor fallback is phrased so the
# fixed sentence "Your advisor X will assist you personally." stays grammatical.
_DEFAULT_PARAM_VALUES = {"name": _DEFAULT_NAME, "advisor_name": "at Topaz Furniture"}

# There is no literal for `advisor_phone` here BY DESIGN — a phone number is
# configuration (SHOWROOM_CONTACT_NUMBER), and the send path passes it in via the
# `defaults` argument below. Meta REJECTS a template send with an empty parameter, so
# the caller must always supply something; missing_params() is the pre-send assertion.


def _with_defaults(template_vars: dict, defaults: dict | None = None) -> dict:
    """Return a copy of template_vars with falsy known keys replaced by defaults.

    `defaults` are the CALLER's fallbacks (config-derived, e.g. the showroom number) and
    are applied on top of the module's built-in copy fallbacks.
    """
    variables = dict(template_vars)
    for key, default in {**_DEFAULT_PARAM_VALUES, **(defaults or {})}.items():
        if not variables.get(key):
            variables[key] = default
    return variables


def welcome_template_key(*, v2_enabled: bool) -> str:
    """Which welcome entry to SEND with. Resolved at send time, not at schedule time.

    A welcome is queued now and sent up to WELCOME_FOLLOWUP_DELAY_MINUTES later, so
    writing the variant into the `followups` row would freeze a queued message on the
    variant that was live when the customer walked in — and would leave rows pointing at
    v2 if the flag were rolled back after Meta rejected it.
    """
    return "welcome_visit_v2" if v2_enabled else "welcome_visit"


def render_followup(template_name: str, template_vars: dict, defaults: dict | None = None) -> str:
    """Render the free-form body for a followup; raises KeyError on unknown template."""
    template = FOLLOWUP_TEMPLATES[template_name]
    return template.body.format_map(_SafeDict(_with_defaults(template_vars, defaults)))


def missing_params(
    template_name: str, template_vars: dict, defaults: dict | None = None
) -> tuple[str, ...]:
    """Named parameters that would go out EMPTY on a template send.

    Meta rejects the whole send when any body parameter is blank, and the error comes
    back as a generic 400 — so the caller checks this first and logs the actual key.
    """
    template = FOLLOWUP_TEMPLATES[template_name]
    variables = _with_defaults(template_vars, defaults)
    return tuple(
        meta_name
        for meta_name, var_key in template.meta_params
        if not str(variables.get(var_key, "")).strip()
    )


def meta_template_params(
    template_name: str, template_vars: dict, defaults: dict | None = None
) -> tuple[str, list[dict]]:
    """Return (meta_template_name, named body parameters) for a template send.

    Parameters are Cloud API body-component objects with `parameter_name` set —
    the registered templates use NAMED parameter format, not positional.
    """
    template = FOLLOWUP_TEMPLATES[template_name]
    variables = _with_defaults(template_vars, defaults)
    params = [
        {"type": "text", "parameter_name": meta_name, "text": str(variables.get(var_key, ""))}
        for meta_name, var_key in template.meta_params
    ]
    return template.meta_template, params
