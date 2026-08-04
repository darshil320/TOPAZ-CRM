"""Production + transit notifications (module 12 hooks, module 14 payloads).

Two tasks, both enqueued fire-and-forget by the API routers:

  notify_production_event(kind, payload)  — stage done / blocked / unblocked
  notify_transfer_event(kind, payload)    — a consignment changed hands

DESIGN RULES this file obeys:

  * **Never raise into the caller.** The routers already committed and already told the
    manager the tap worked. A notification failure is logged and retried by Celery, not
    surfaced (same trade tasks/receipts makes).
  * **All copy comes from services/transit_messages.py**, which is pure and tested. No
    string building here.
  * **Recipients are resolved at SEND time, not at enqueue time.** The lead of a
    workshop can change between the tap and the send, and the person who should hear
    about it is whoever holds the post now.
  * **Money-blind.** The audiences (workshop leads, couriers) have no money access
    anywhere else in this system; a rupee figure here would walk past all of it.
  * **Always the approved template, never free text.** Unlike the customer-facing
    send path (tasks/quotes.py), which branches on the 24h window using `messages`'
    last-inbound tracking, there is no equivalent table for STAFF — nothing records
    when a workshop lead or courier last texted the business number. Sending the
    approved template unconditionally is simpler and correct: it reaches the
    recipient whether or not they have an open session. Three templates cover every
    alert kind here, submitted and approved 2026-07-27 (see
    services/transit_messages.py's module docstring for the exact registered text):
    `topaz_transfer_incoming`, `topaz_transfer_status`, `topaz_production_alert`.
"""

import asyncio
import logging

from sqlalchemy import text

from ..database import make_task_session
from ..repositories import alert_repo, transfer_repo, workshop_staff_repo
from ..services import transit_messages
from .celery_app import celery_app

logger = logging.getLogger(__name__)

# Which side of a consignment hears about which edge. Resolved to real phone numbers at
# send time; a side with no reachable lead is skipped with a log line, never an error.
_TRANSFER_AUDIENCE: dict[str, tuple[str, ...]] = {
    "created": ("to", "courier"),
    "assigned": ("courier",),
    "picked_up": ("from", "to"),
    "in_transit": ("to",),
    "delivered": ("to",),
    "received": ("from",),
    "cancelled": ("from", "to", "courier"),
}


async def _send_template(to: str | None, template_name: str, params: list[dict], *, what: str) -> bool:
    """One approved-template send. Returns False (and logs) instead of raising when
    there is nobody to send to — a vendor workshop with no phone number on file is a
    normal state — or when Meta rejects the send (e.g. the template is still In
    review): a notification failure must never look like a failed handover."""
    if not to:
        logger.info("No recipient for %s — skipped", what)
        return False
    from .whatsapp import send_wa_template

    try:
        await asyncio.to_thread(send_wa_template, to, template_name, params)
        return True
    except Exception as exc:  # noqa: BLE001 — a failed notification is not a failed handover
        logger.warning("Notification send failed (%s → %s, template %s): %s",
                       what, to, template_name, exc)
        return False


async def _courier_phone(session, transfer: dict) -> str | None:
    courier_id = transfer.get("courier_salesperson_id")
    if courier_id is None:
        return None
    row = await session.execute(
        text("SELECT whatsapp FROM salespersons WHERE id = :id AND active = true"),
        {"id": str(courier_id)},
    )
    found = row.first()
    return str(found[0]) if found and found[0] else None


#  Which template each transfer edge sends through, and how its params are filled.
_STATUS_TEXT: dict[str, str] = {
    "picked_up": "Picked up",
    "in_transit": "On the road",
    "delivered": "Delivered",
    "received": "Received",
    "cancelled": "Cancelled",
}


async def _run_transfer(kind: str, payload: dict) -> dict:
    transfer_id = payload.get("transfer_id")
    if not transfer_id:
        logger.warning("notify_transfer_event(%s) with no transfer_id: %s", kind, payload)
        return {"sent": 0}

    from uuid import UUID

    async with make_task_session() as session:
        transfer = await transfer_repo.get_transfer(session, UUID(str(transfer_id)))
        if transfer is None:
            logger.warning("notify_transfer_event(%s): consignment %s is gone", kind, transfer_id)
            return {"sent": 0}
        items = await transfer_repo.transfer_items(session, UUID(str(transfer_id)))

        from_lead = await workshop_staff_repo.lead_contact(
            session, transfer["from_workshop_id"]
        )
        to_lead = await workshop_staff_repo.lead_contact(session, transfer["to_workshop_id"])
        courier_phone = await _courier_phone(session, transfer)

    from_name = str(transfer["from_workshop_name"])
    to_name = str(transfer["to_workshop_name"])

    if kind in ("created", "assigned"):
        template_name = transit_messages.TEMPLATE_TRANSFER_INCOMING
        params = transit_messages.transfer_incoming_params(
            transfer_no=transfer["transfer_no"], from_workshop=from_name,
            to_workshop=to_name, item_count=len(items), due_at=transfer["due_at"],
        )
    elif kind in ("picked_up", "in_transit", "delivered", "received", "cancelled"):
        template_name = transit_messages.TEMPLATE_TRANSFER_STATUS
        # 'cancelled' leaves the goods at the ORIGIN — every other edge is framed
        # around the destination, which is where the reader's attention belongs.
        workshop_name = from_name if kind == "cancelled" else to_name
        note = (
            transfer.get("cancel_reason") if kind == "cancelled"
            else transfer.get("vehicle_no") if kind == "picked_up"
            else None
        )
        params = transit_messages.transfer_status_params(
            transfer_no=transfer["transfer_no"], status_text=_STATUS_TEXT[kind],
            workshop_name=workshop_name, note=note,
        )
    else:
        logger.info("notify_transfer_event: nothing to say for kind '%s'", kind)
        return {"sent": 0}

    targets: list[tuple[str, str | None]] = []
    for side in _TRANSFER_AUDIENCE.get(kind, ()):
        if side == "from":
            targets.append(("from-lead", from_lead["whatsapp"] if from_lead else None))
        elif side == "to":
            targets.append(("to-lead", to_lead["whatsapp"] if to_lead else None))
        elif side == "courier":
            targets.append(("courier", courier_phone))

    sent = 0
    for label, phone in targets:
        if await _send_template(phone, template_name, params, what=f"transfer.{kind}/{label}"):
            sent += 1
    logger.info("transfer notification %s for %s: %d sent", kind, transfer["transfer_no"], sent)
    return {"sent": sent}


async def _claim_item_ready(session, item_id: str) -> bool:
    """Atomically claim the "this item is finished" notification (0038).

    THE single-fire guarantee. Both predicates matter: `ready_notified_at IS NULL` stops a
    Celery retry re-messaging, and `production_done_at IS NOT NULL` stops a stale payload
    (an event replayed after an admin override moved the item) claiming an item that is
    not actually finished.
    """
    result = await session.execute(
        text(
            "UPDATE order_items SET ready_notified_at = now()"
            " WHERE id = cast(:id as uuid)"
            "   AND production_done_at IS NOT NULL AND ready_notified_at IS NULL"
            " RETURNING id"
        ),
        {"id": item_id},
    )
    return result.first() is not None


async def _run_item_ready(item_id: str) -> dict:
    """REQ 6 — the last stage cleared: tell the salesperson who sold it.

    Order of operations is load-bearing:
      1. CLAIM (0038) — before anything is read or sent, so a retry stops here.
      2. Write the `alerts` row and COMMIT — the durable record. The dashboard shows
         "ready to deliver" even if WhatsApp is down or `topaz_item_ready` is still in
         Meta review.
      3. Send. A failure here is logged and NOT rolled back: re-sending on the next retry
         to a salesperson who already got the message is worse than one missed nudge, and
         the alert row already carries the fact.
    """
    from uuid import UUID

    async with make_task_session() as session:
        if not await _claim_item_ready(session, item_id):
            logger.info("item_ready for %s: already notified or not finished", item_id)
            await session.commit()
            return {"sent": 0}

        row = await session.execute(
            text(
                "SELECT oi.description, o.order_no, o.id AS order_id, o.customer_id,"
                "       o.grand_total, c.name AS customer_name,"
                "       (SELECT coalesce(sum(p.amount), 0) FROM payments p"
                "         WHERE p.order_id = o.id) AS paid,"
                "       sp.name AS advisor_name, sp.whatsapp AS advisor_whatsapp"
                " FROM order_items oi"
                " JOIN orders o ON o.id = oi.order_id"
                " JOIN customers c ON c.id = o.customer_id"
                " LEFT JOIN customer_assignments ca"
                "        ON ca.customer_id = o.customer_id AND ca.role = 'primary'"
                "       AND ca.active = true"
                " LEFT JOIN salespersons sp"
                "        ON sp.id = ca.salesperson_id AND sp.active = true"
                " WHERE oi.id = cast(:id as uuid)"
            ),
            {"id": item_id},
        )
        item = row.mappings().first()
        if item is None:
            logger.warning("item_ready: order item %s is gone", item_id)
            await session.commit()
            return {"sent": 0}

        balance = None
        if item["grand_total"] is not None:
            balance = float(item["grand_total"]) - float(item["paid"] or 0)

        alert_id = await alert_repo.create_alert(
            session,
            customer_id=UUID(str(item["customer_id"])),
            type_="item_ready",
            detail=f"{item['description']} is ready to deliver ({item['order_no']})",
            # 0038: the feed's CTA opens THIS order, where the payment form and the
            # delivery scheduler both live.
            order_id=UUID(str(item["order_id"])),
        )
        # An UNCLAIMED customer has no advisor — the owner is the fallback, because "the
        # goods are finished and nobody has been told" is the failure this exists to stop.
        recipient = item["advisor_whatsapp"] or await alert_repo.get_owner_whatsapp(session)
        await session.commit()

    params = transit_messages.item_ready_params(
        order_no=str(item["order_no"]),
        item_description=str(item["description"]),
        customer_name=str(item["customer_name"]),
        balance_due=balance,
    )
    sent = int(await _send_template(
        recipient, transit_messages.TEMPLATE_ITEM_READY, params,
        what=f"item_ready/{item['order_no']}",
    ))
    logger.info("item_ready notification for %s: alert %s, %d sent",
                item["order_no"], alert_id, sent)
    return {"sent": sent, "alert_id": str(alert_id), "order_id": str(item["order_id"])}


async def _run_production(kind: str, payload: dict) -> dict:
    """Stage events.

    Two kinds reach out. `blocked` — a stuck item needs a human. And a `stage_done` that
    was the item's LAST stage (`done: true` in the payload, computed by
    api/production.advance) — REQ 6's "ready to deliver" nudge to the salesperson.

    Every OTHER stage tap stays log-only, deliberately: nobody wants a WhatsApp per stage
    on eleven stages per item. The live board (Realtime) is how sales watch progress, and
    the customer-facing `production_started` / `production_completed` templates are module
    12's scope, not this one's.
    """
    if kind == "stage_done" and payload.get("done"):
        item_id = payload.get("order_item_id")
        if not item_id:
            logger.warning("stage_done(done=true) with no order_item_id: %s", payload)
            return {"sent": 0}
        return await _run_item_ready(str(item_id))

    if kind != "blocked":
        logger.info("production notification %s: %s (log only)", kind, payload)
        return {"sent": 0}

    from uuid import UUID

    item_id = payload.get("order_item_id")
    if not item_id:
        return {"sent": 0}

    async with make_task_session() as session:
        row = await session.execute(
            text(
                "SELECT oi.description, oi.blocked, o.order_no, o.customer_id,"
                "       w.name AS workshop_name, a.due_at,"
                "       (SELECT note FROM production_events e"
                "         WHERE e.order_item_id = oi.id AND e.kind = 'blocked'"
                "         ORDER BY e.at DESC LIMIT 1) AS blocker_note"
                " FROM order_items oi"
                " JOIN orders o ON o.id = oi.order_id"
                " LEFT JOIN workshops w ON w.id = oi.workshop_id"
                " LEFT JOIN order_item_assignments a"
                "        ON a.order_item_id = oi.id AND a.active = true"
                " WHERE oi.id = cast(:id as uuid)"
            ),
            {"id": str(item_id)},
        )
        item = row.mappings().first()
        if item is None:
            return {"sent": 0}
        owner_phone = await alert_repo.get_owner_whatsapp(session)
        alert_id = await alert_repo.create_alert(
            session,
            customer_id=UUID(str(item["customer_id"])),
            type_="production_blocked",
            detail=f"{item['description']} — {item['blocker_note'] or 'no reason given'}",
        )
        await session.commit()

    params = transit_messages.production_alert_params(
        order_no=item["order_no"], item_description=item["description"],
        workshop_name=item["workshop_name"] or "workshop", issue="Blocked",
        detail=f"Reason: {item['blocker_note']}" if item["blocker_note"]
               else f"Due: {transit_messages.format_ist(item['due_at'])}",
    )
    sent = int(await _send_template(
        owner_phone, transit_messages.TEMPLATE_PRODUCTION_ALERT, params,
        what="production.blocked/owner",
    ))
    logger.info("production blocked notification: alert %s, %d sent", alert_id, sent)
    return {"sent": sent, "alert_id": str(alert_id)}


@celery_app.task(bind=True, name="src.tasks.production_notify.notify_production_event",
                 max_retries=3, default_retry_delay=30, acks_late=True)
def notify_production_event(self, kind: str, payload: dict) -> dict:
    try:
        return asyncio.run(_run_production(kind, payload))
    except Exception as exc:
        raise self.retry(exc=exc)


@celery_app.task(bind=True, name="src.tasks.production_notify.notify_transfer_event",
                 max_retries=3, default_retry_delay=30, acks_late=True)
def notify_transfer_event(self, kind: str, payload: dict) -> dict:
    try:
        return asyncio.run(_run_transfer(kind, payload))
    except Exception as exc:
        raise self.retry(exc=exc)
