"""Pure message copy for production/transit notifications (module 14).

Copy lives here, not inside the Celery tasks, for the reason every other message
builder in this repo does: it is the part that is worth unit-testing (a manager
misreading which workshop the goods are going to is a real cost) and the part that has
no business touching the network.

AUDIENCE IS STAFF, NOT CUSTOMERS. These go to a manager's or a courier's handset, so:
  * Gujarati first, English second — the same rule the workshop PWA follows (module 10):
    the target reader is a 45-year-old floor manager, and English is the fallback.
  * No money, ever. Workshop and courier audiences are money-blind by design; a rupee
    figure in a transit alert would leak straight past every RLS boundary built for it.
  * They are FREE-FORM text sends. Meta's 24-hour rule applies to a staff handset
    exactly as it does to a customer's, so a manager who has never messaged the business
    number will not receive these until the templates below are approved:
        transfer_assigned   — a consignment is on its way to you
        leg_overdue         — an item's deadline has passed
    Until then the in-window text path works and the out-of-window send is logged as a
    failure rather than silently dropped (tasks/whatsapp records the send result).
"""

from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def format_ist(moment: datetime | None) -> str:
    """'Thu 30 Jul, 6:00 PM' in IST — the format the workshop card and the WhatsApp
    line both use, so a manager comparing the two sees the same string.

    Returns an em dash for None rather than 'None': a missing deadline is a real state
    (a leg planned without days), and it must read as absent, not as a bug.
    """
    if moment is None:
        return "—"
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    local = moment.astimezone(IST)
    # The 12-hour part is assembled by hand rather than with %-I: the dash flag is a
    # GNU extension and this string is built on macOS in dev and Linux in prod.
    hour12 = local.hour % 12 or 12
    meridiem = "AM" if local.hour < 12 else "PM"
    return f"{local.strftime('%a %d %b')}, {hour12}:{local.strftime('%M')} {meridiem}"


def overdue_by(due_at: datetime | None, *, now: datetime | None = None) -> str:
    """Human-readable lateness: '3 days late', '5 hours late', 'due now'."""
    if due_at is None:
        return ""
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


def transfer_assigned(
    *,
    transfer_no: str,
    from_workshop: str,
    to_workshop: str,
    item_count: int,
    due_at: datetime | None,
    dashboard_url: str | None = None,
) -> str:
    """To the DESTINATION lead (and the courier): goods are coming."""
    items = f"{item_count} નંગ / {item_count} item{'s' if item_count != 1 else ''}"
    body = (
        f"🚚 *માલ આવી રહ્યો છે / Incoming goods*\n"
        f"{transfer_no} · {items}\n"
        f"{from_workshop} → *{to_workshop}*\n"
        f"પહોંચવાનો સમય / Due: {format_ist(due_at)}"
    )
    if dashboard_url:
        body += f"\n\nસ્વીકારો / Receive → {dashboard_url}"
    return body


def transfer_picked_up(*, transfer_no: str, to_workshop: str,
                       courier_name: str | None = None) -> str:
    who = courier_name or "ડ્રાઇવર / driver"
    return (
        f"📦 *માલ નીકળ્યો / Goods collected*\n"
        f"{transfer_no} · {who}\n"
        f"જઈ રહ્યો છે / Heading to: *{to_workshop}*"
    )


def transfer_received(*, transfer_no: str, to_workshop: str, item_count: int) -> str:
    return (
        f"✅ *માલ મળ્યો / Goods received*\n"
        f"{transfer_no} · {item_count} નંગ / item{'s' if item_count != 1 else ''}\n"
        f"*{to_workshop}* પર કામ શરૂ / work can start"
    )


def leg_overdue(
    *,
    item_description: str,
    order_no: str,
    workshop: str,
    due_at: datetime | None,
    blocked: bool,
    now: datetime | None = None,
    dashboard_url: str | None = None,
) -> str:
    """To the owner and the order's salesperson: a workshop has missed its deadline.

    Says whether the item is BLOCKED, because the two situations need opposite
    responses — a blocked item needs the blocker cleared, an unblocked late item needs
    somebody to ask why nothing is happening.
    """
    late = overdue_by(due_at, now=now)
    reason = "\n⛔ અવરોધિત / BLOCKED — કારણ તપાસો / check the blocker" if blocked else ""
    body = (
        f"⏰ *સમય વીતી ગયો / Deadline missed*\n"
        f"{order_no} · {item_description}\n"
        f"{workshop} · {late}\n"
        f"નિયત સમય / Was due: {format_ist(due_at)}{reason}"
    )
    if dashboard_url:
        body += f"\n\n{dashboard_url}"
    return body


def pickup_overdue(
    *,
    transfer_no: str,
    from_workshop: str,
    to_workshop: str,
    expected_pickup_at: datetime | None,
    now: datetime | None = None,
) -> str:
    """To the owner and the origin lead: a consignment is packed and nobody came."""
    return (
        f"🕒 *માલ ઉપાડવાનો બાકી / Pickup pending*\n"
        f"{transfer_no} · {from_workshop} → {to_workshop}\n"
        f"ઉપાડવાનો સમય / Expected: {format_ist(expected_pickup_at)}"
        f" ({overdue_by(expected_pickup_at, now=now)})"
    )
