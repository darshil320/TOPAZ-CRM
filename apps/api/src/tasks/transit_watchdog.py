"""Daily beat task: find production that has silently stopped moving (module 14).

Two scans, both cheap and both index-served:

  1. **Overdue legs** — an active leg whose `due_at` has passed and whose span is not
     finished (order_item_route_legs_due_idx). This is the whole point of putting a date
     AND TIME on the workshop card: a deadline nobody checks is decoration.
  2. **Stale pickups** — a consignment sitting at `ready` past its pickup window
     (workshop_transfers_pickup_idx). The failure mode this catches is the quiet one:
     goods packed, paperwork done, and no tempo ever came.

DEDUPE: one alert per (item, day) and per (consignment, day). Without it a 3-day-late
item generates an alert every run and the owner learns to ignore the feed — which is
worse than no watchdog, because it also buries the real ones. The check is a NOT EXISTS
against today's alerts rather than a state column, so a re-run after a crash is safe.

Items with no `due_at` are NEVER counted: the watchdog must not count days against
nobody (0024's rule for unallocated items, applied to legs).
"""

import asyncio
import logging

from sqlalchemy import text

from ..database import make_task_session
from ..repositories import alert_repo, route_repo, transfer_repo, workshop_staff_repo
from ..services import transit_messages
from .celery_app import celery_app

logger = logging.getLogger(__name__)


async def _already_alerted_today(session, *, customer_id: str, type_: str, detail_like: str) -> bool:
    """Has this exact signal already fired since midnight IST?

    Matched on the detail text because `alerts` has no entity column for an order item —
    adding one is a schema change for a dedupe key, and the detail line already contains
    the item's identity verbatim (it is built once, in this file).
    """
    result = await session.execute(
        text(
            "SELECT 1 FROM alerts"
            " WHERE customer_id = cast(:cid as uuid) AND type = :type"
            "   AND detail = :detail"
            "   AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')"
            "       AT TIME ZONE 'Asia/Kolkata'"
            " LIMIT 1"
        ),
        {"cid": customer_id, "type": type_, "detail": detail_like},
    )
    return result.first() is not None


async def _send_template(to: str | None, template_name: str, params: list[dict], *, what: str) -> bool:
    if not to:
        logger.info("watchdog: no recipient for %s", what)
        return False
    from .whatsapp import send_wa_template

    try:
        await asyncio.to_thread(send_wa_template, to, template_name, params)
        return True
    except Exception as exc:  # noqa: BLE001 — a failed alert must not abort the scan
        logger.warning("watchdog send failed (%s → %s, template %s): %s",
                       what, to, template_name, exc)
        return False


async def _scan_overdue_legs(session) -> dict:
    legs = await route_repo.overdue_active_legs(session)
    owner_phone = await alert_repo.get_owner_whatsapp(session)
    alerted = 0
    skipped = 0

    for leg in legs:
        detail = (
            f"{leg['order_no']} · {leg['description']} at {leg['workshop_name']} — "
            f"{transit_messages.overdue_by(leg['due_at'])}"
        )
        if await _already_alerted_today(
            session, customer_id=str(leg["customer_id"]), type_="leg_overdue", detail_like=detail
        ):
            skipped += 1
            continue

        await alert_repo.create_alert(
            session, customer_id=leg["customer_id"], type_="leg_overdue", detail=detail
        )
        params = transit_messages.production_alert_params(
            order_no=str(leg["order_no"]), item_description=str(leg["description"]),
            workshop_name=str(leg["workshop_name"]),
            issue=("Blocked — " if leg["blocked"] else "") + transit_messages.overdue_by(leg["due_at"]),
            detail=f"Was due {transit_messages.format_ist(leg['due_at'])}",
        )
        await _send_template(owner_phone, transit_messages.TEMPLATE_PRODUCTION_ALERT, params,
                             what=f"leg_overdue/{leg['order_no']}")
        # The workshop's own lead hears about it too — the owner cannot fix a delay, the
        # floor can.
        lead = await workshop_staff_repo.lead_contact(session, leg["workshop_id"])
        if lead and lead["whatsapp"] and lead["whatsapp"] != owner_phone:
            await _send_template(lead["whatsapp"], transit_messages.TEMPLATE_PRODUCTION_ALERT,
                                 params, what=f"leg_overdue/lead/{leg['order_no']}")
        alerted += 1

    await session.commit()
    return {"overdue_legs": len(legs), "alerted": alerted, "deduped": skipped}


async def _scan_stale_pickups(session) -> dict:
    stale = await transfer_repo.stale_pickups(session)
    owner_phone = await alert_repo.get_owner_whatsapp(session)
    alerted = 0

    for transfer in stale:
        params = transit_messages.transfer_status_params(
            transfer_no=str(transfer["transfer_no"]), status_text="Pickup pending",
            workshop_name=str(transfer["from_workshop_name"]),
            note=f"Expected {transit_messages.format_ist(transfer['expected_pickup_at'])}",
        )
        # No `alerts` row for this one: `alerts.customer_id` is NOT NULL and a
        # consignment can legitimately carry several customers' items, so there is no
        # single honest customer to file it against. Picking one would put a false
        # alert on that customer's timeline. The WhatsApp line to the owner and the
        # origin lead is the signal; the consignment row itself is the record.
        await _send_template(owner_phone, transit_messages.TEMPLATE_TRANSFER_STATUS, params,
                             what=f"pickup_overdue/{transfer['transfer_no']}")
        lead = await workshop_staff_repo.lead_contact(session, transfer["from_workshop_id"])
        if lead and lead["whatsapp"] and lead["whatsapp"] != owner_phone:
            await _send_template(lead["whatsapp"], transit_messages.TEMPLATE_TRANSFER_STATUS,
                                 params, what=f"pickup_overdue/lead/{transfer['transfer_no']}")
        alerted += 1

    return {"stale_pickups": len(stale), "alerted": alerted}


async def _run() -> dict:
    async with make_task_session() as session:
        legs = await _scan_overdue_legs(session)
        pickups = await _scan_stale_pickups(session)
    result = {**legs, **{f"pickup_{k}": v for k, v in pickups.items()}}
    logger.info("transit watchdog: %s", result)
    return result


@celery_app.task(bind=True, name="src.tasks.transit_watchdog.scan_production_delays",
                 max_retries=2, default_retry_delay=120, acks_late=True)
def scan_production_delays(self) -> dict:
    try:
        return asyncio.run(_run())
    except Exception as exc:
        raise self.retry(exc=exc)
