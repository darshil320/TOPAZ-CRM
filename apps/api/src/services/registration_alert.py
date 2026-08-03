"""Named-param builder for the new-kiosk-registration staff broadcast (Meta template).

Same reasoning as services/transit_messages.py and services/templates.py's
FollowupTemplate.meta_params: free-form WhatsApp only reaches a recipient inside a
24h service window, and staff have no `last_inbound_at`-style tracking the way
customers do (see tasks/whatsapp.py::send_new_registration_alert's own docstring
for why it started as free text and is being upgraded here). An approved Utility
template reaches every recipient regardless of window state.

Template: `topaz_new_customer` (Utility, English), submitted alongside this code —
exact body text pinned here so a diff against what Meta actually approved is a
one-line comparison, not a guess:

    🆕 New customer registered!

    {{customer_name}} just signed up at the kiosk.
    Interested in: {{interest}}

    Check the dashboard to claim them.
"""

TEMPLATE_NEW_CUSTOMER = "topaz_new_customer"

# Meta requires every named parameter filled — a template cannot conditionally
# omit a line the way free text can, so a missing interest becomes this instead
# of an empty string (which would render as a blank line inside fixed wording).
_NO_INTEREST = "Not specified"


def new_customer_params(name: str | None, interest: str | None) -> list[dict]:
    """Meta Cloud API named body-parameter list for `topaz_new_customer`."""
    return [
        {"type": "text", "parameter_name": "customer_name", "text": (name or "A new customer").title()},
        {"type": "text", "parameter_name": "interest", "text": interest or _NO_INTEREST},
    ]
