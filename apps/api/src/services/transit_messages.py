"""Staff-facing WhatsApp copy for production/transit alerts (module 14).

Three Meta templates, submitted 2026-07-27, cover every alert kind this module
sends — mirrors the house registry pattern in services/templates.py
(FollowupTemplate.meta_params → meta_template_params), but for STAFF recipients
rather than customers:

  topaz_transfer_incoming  — a consignment is heading to a workshop
  topaz_transfer_status    — a consignment's state changed (picked up/delivered/
                              received/cancelled)
  topaz_production_alert   — something needs a human: a missed deadline or a
                              blocked item

WHY ALWAYS THE TEMPLATE, NEVER FREE TEXT (unlike the customer-facing send path in
tasks/quotes.py, which branches on the 24h window): that branch works for customers
because `messages` tracks each customer's last inbound message. There is no
equivalent table for STAFF — nothing records when a workshop lead or courier last
texted the business number — so there is no reliable window to check. Sending the
approved template unconditionally is simpler and correct: it reaches the recipient
whether or not they have an open session, with identical wording either way.

All three are Utility category (transactional, not marketing) — same category as
`payment_due` — so they do not require marketing consent (these recipients are staff,
not customers, and consent tracking does not apply to them regardless).

MONEY: every parameter built here comes from a money-blind projection (transfer_repo,
route_repo, production_repo money-blind reads) — no function in this file may ever be
handed a price, and none accepts one.
"""

from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))

TEMPLATE_TRANSFER_INCOMING = "topaz_transfer_incoming"
TEMPLATE_TRANSFER_STATUS = "topaz_transfer_status"
TEMPLATE_PRODUCTION_ALERT = "topaz_production_alert"

# Fixed body text a human read at submission time (WhatsApp Manager), kept here so a
# change to the registered template is a one-line diff against what Meta actually
# approved, not a guess from the param builders alone.
#
# topaz_transfer_incoming:
#   🚚 Incoming goods — {{transfer_no}}
#
#   From: {{from_workshop}}
#   To: {{to_workshop}}
#   Items: {{item_count}}
#   Due: {{due_at}}
#
# topaz_transfer_status:
#   📦 {{transfer_no}} update
#
#   Status: {{status_text}}
#   Workshop: {{workshop_name}}
#   {{note}}
#
# topaz_production_alert:
#   ⚠️ Action needed — {{order_no}}
#
#   Item: {{item_description}}
#   Workshop: {{workshop_name}}
#   Issue: {{issue}}
#   {{detail}}

# Meta named parameters are always sent as text, always filled — an approved template
# renders its fixed wording around whatever is supplied, so an empty string reads as a
# blank line rather than the absent line free text would have. This is the one filler
# a param may fall back to; never the empty string.
_EMPTY = "—"


def format_ist(moment: datetime | None) -> str:
    """'Thu 30 Jul, 6:00 PM' in IST — the same string a workshop card renders, so a
    manager comparing the WhatsApp line to their screen sees an identical value."""
    if moment is None:
        return _EMPTY
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    local = moment.astimezone(IST)
    # Built by hand rather than with %-I: that flag is a GNU extension, and this runs
    # on macOS in dev and Linux in prod.
    hour12 = local.hour % 12 or 12
    meridiem = "AM" if local.hour < 12 else "PM"
    return f"{local.strftime('%a %d %b')}, {hour12}:{local.strftime('%M')} {meridiem}"


def overdue_by(due_at: datetime | None, *, now: datetime | None = None) -> str:
    """Human-readable lateness: '3 days late', '5 hours late', 'due now'."""
    if due_at is None:
        return _EMPTY
    now = now or datetime.now(timezone.utc)
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=timezone.utc)
    delta = now - due_at
    if delta.total_seconds() < 0:
        return "not yet due"
    days = delta.days
    if days >= 1:
        return f"{days} day{'s' if days > 1 else ''} late"
    hours = int(delta.total_seconds() // 3600)
    if hours >= 1:
        return f"{hours} hour{'s' if hours > 1 else ''} late"
    return "due now"


def _named(**kwargs: object) -> list[dict]:
    """Meta named-parameter body components. Every value is stringified; a falsy
    value becomes `_EMPTY` rather than an empty string, matching what a human
    reviewing the sent message should see instead of a blank line."""
    return [
        {"type": "text", "parameter_name": name, "text": str(value) if value else _EMPTY}
        for name, value in kwargs.items()
    ]


def transfer_incoming_params(
    *,
    transfer_no: str,
    from_workshop: str,
    to_workshop: str,
    item_count: int,
    due_at: datetime | None,
) -> list[dict]:
    return _named(
        transfer_no=transfer_no,
        from_workshop=from_workshop,
        to_workshop=to_workshop,
        item_count=item_count,
        due_at=format_ist(due_at),
    )


def transfer_status_params(
    *,
    transfer_no: str,
    status_text: str,
    workshop_name: str,
    note: str | None = None,
) -> list[dict]:
    return _named(
        transfer_no=transfer_no,
        status_text=status_text,
        workshop_name=workshop_name,
        note=note,
    )


def production_alert_params(
    *,
    order_no: str,
    item_description: str,
    workshop_name: str,
    issue: str,
    detail: str | None = None,
) -> list[dict]:
    return _named(
        order_no=order_no,
        item_description=item_description,
        workshop_name=workshop_name,
        issue=issue,
        detail=detail,
    )
