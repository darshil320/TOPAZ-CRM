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
# REQ 6 — an item cleared its last stage. NEEDS META APPROVAL before the send path can
# use it (Utility category, like the three above). Until it shows APPROVED in WhatsApp
# Manager the send fails and is logged; the `alerts` row is written either way, so the
# dashboard still shows the item as ready. See tasks/production_notify._run_item_ready.
TEMPLATE_ITEM_READY = "topaz_item_ready"

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
#
# topaz_item_ready (REQ 6 — SUBMITTED, awaiting Meta review):
#   ✅ Ready to deliver — {{order_no}}
#
#   Item: {{item_description}}
#   Customer: {{customer_name}}
#   Balance due: {{balance_due}}
#
# MONEY IS DELIBERATE HERE and nowhere else in this file: the audience is the assigned
# SALESPERSON, whose whole next action is collecting the balance and booking the delivery.
# The money-blind rule protects the workshop and courier audiences — it is not a rule
# about the template registry. No workshop recipient is ever sent this template.

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


def item_ready_params(
    *,
    order_no: str,
    item_description: str,
    customer_name: str,
    balance_due: float | int | None = None,
) -> list[dict]:
    """REQ 6 — the assigned salesperson's "go collect and book the delivery" nudge.

    `balance_due` is formatted here rather than by the caller so the rupee string is
    identical in every message: '₹1,25,000' in Indian grouping, or 'Fully paid' at zero.
    A None (unknown, e.g. no payment rows yet) reads as the order value being outstanding
    is unproven — so it degrades to the neutral filler rather than claiming ₹0.
    """
    return _named(
        order_no=order_no,
        item_description=item_description,
        customer_name=customer_name,
        balance_due=format_inr(balance_due),
    )


def format_inr(amount: float | int | None) -> str:
    """'₹1,25,000' — Indian digit grouping (2,2,3), not the 3,3,3 of `format(x, ',')`."""
    if amount is None:
        return _EMPTY
    rupees = int(round(float(amount)))
    if rupees <= 0:
        return "Fully paid"
    digits = str(rupees)
    if len(digits) <= 3:
        return f"₹{digits}"
    head, tail = digits[:-3], digits[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return f"₹{','.join(groups)},{tail}"
