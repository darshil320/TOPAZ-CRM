"""Custody handover between workshops — the two transactions that matter (module 14).

`open_handover()` and `receive_transfer()` are shared by two routers (a handover is
opened automatically by `POST /production/items/{id}/advance` when a leg's last stage
is ticked, and manually by `POST /transfers`), so they live here rather than in either
one.

WHY NOT A DB TRIGGER: creating a consignment is business logic, and 0024's trigger
scope fence limits `production_event_apply()` to maintaining denorm. A trigger that
also invented transfer rows would make the state machine untestable in isolation and
un-rollback-able (module 14 D7).

Both functions assume the caller has already:
  * authorized the actor (api/authz.capabilities_at_workshop),
  * taken the row locks (production_repo.lock_item_for_event / transfer_repo.lock_transfer),
  * and they leave the COMMIT to the caller.
"""

import logging
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from ..repositories import production_repo, route_repo, transfer_repo
from . import numbering

logger = logging.getLogger(__name__)

# doc_series key (0012). Free-form text, so no migration is needed to add a series.
TRANSFER_SERIES = "TRF"


async def open_handover(
    session: AsyncSession,
    *,
    order_item_id: UUID | str,
    from_workshop_id: str,
    to_workshop_id: str,
    completed_leg_id: str | None,
    destination_leg_id: str | None,
    due_at: datetime | None,
    actor_id: str | None,
    reason: str = "next_stage",
    courier_salesperson_id: str | None = None,
    expected_pickup_at: datetime | None = None,
    notes: str | None = None,
    qty: float | None = None,
) -> dict:
    """Close the leg that just finished and put its item on a consignment.

    `destination_leg_id` is stored on the consignment LINE, not on the consignment: it
    is the leg `receive` will activate. A transfer with no destination leg is legal —
    that is the legacy single-workshop item being moved by hand — and receive falls
    back to allocating straight to `to_workshop_id`.

    The consignment is created at `ready`, i.e. "waiting for a courier to pick it up".
    It is NOT created at `picked_up`: the goods have not moved yet and pretending they
    have is what makes a lost consignment unattributable (module 14 D10).
    """
    if completed_leg_id is not None:
        await route_repo.set_leg_status(
            session, completed_leg_id, "completed", stamp_completed=True
        )
    if destination_leg_id is not None:
        await route_repo.set_leg_status(session, destination_leg_id, "in_transit")

    transfer_no = await numbering.allocate(session, TRANSFER_SERIES)
    transfer = await transfer_repo.create_transfer(
        session,
        transfer_no=transfer_no,
        from_workshop_id=from_workshop_id,
        to_workshop_id=to_workshop_id,
        reason=reason,
        due_at=due_at,
        expected_pickup_at=expected_pickup_at,
        courier_salesperson_id=courier_salesperson_id,
        notes=notes,
        actor_id=actor_id,
    )
    # The INSERT below can raise IntegrityError on workshop_transfer_items_one_open
    # (the item is already on an open consignment). It is deliberately NOT caught here:
    # the router maps it to 409, and swallowing it would leave a phantom empty
    # consignment behind with a burnt transfer number.
    await transfer_repo.add_item(
        session,
        transfer_id=transfer["id"],
        order_item_id=order_item_id,
        route_leg_id=destination_leg_id,
        qty=qty,
    )
    await transfer_repo.insert_event(
        session, transfer_id=transfer["id"], kind="created", actor_id=actor_id,
        note=notes,
    )
    await transfer_repo.record_audit(
        session, transfer_id=transfer["id"], action="create", actor_id=actor_id,
        payload={
            "transfer_no": transfer_no,
            "order_item_id": str(order_item_id),
            "from_workshop_id": from_workshop_id,
            "to_workshop_id": to_workshop_id,
            "completed_leg_id": completed_leg_id,
            "destination_leg_id": destination_leg_id,
            "reason": reason,
        },
    )
    logger.info(
        "Handover %s opened: item %s %s → %s (reason=%s)",
        transfer_no, order_item_id, from_workshop_id, to_workshop_id, reason,
    )
    return transfer


async def receive_transfer(
    session: AsyncSession,
    *,
    transfer: dict,
    lines: list[dict],
    actor_id: str | None,
    media_id: str | None = None,
    note: str | None = None,
) -> list[dict]:
    """THE custody transaction. For every line on the consignment:

      1. activate the destination leg (`in_transit` → `active`), and
      2. write a new active assignment at the destination workshop, which fires
         sync_order_item_workshop() and flips `order_items.workshop_id`.

    Then flip the consignment to `received`, which fires sync_transfer_denorm() and
    clears `order_items.transit_transfer_id` — making the item advanceable again.

    `current_stage` is deliberately NOT touched. production_event_apply() already moved
    it to the next stage by `sort` when the origin's last stage was ticked, so the item
    sits at "finishing, not started" while in transit. That is the honest state, and it
    is exactly what the advance-while-in-transit lock protects (module 14 D9).
    """
    to_workshop_id = str(transfer["to_workshop_id"])
    results: list[dict] = []

    for line in lines:
        item_id = line["order_item_id"]
        leg_id = line.get("route_leg_id")
        leg = await route_repo.get_leg(session, leg_id) if leg_id else None

        if leg is not None:
            await route_repo.set_leg_status(
                session, leg["id"], "active", stamp_activated=True
            )

        # Guard the invariant the FOR UPDATE is protecting: allocate() retires the
        # prior assignment and inserts a new one, so a second receive on the same
        # consignment would silently re-allocate. The router refuses a non-open
        # transfer before we get here; this is the belt to that braces.
        allocation = await production_repo.allocate(
            session,
            order_item_id=item_id if isinstance(item_id, UUID) else UUID(str(item_id)),
            workshop_id=UUID(to_workshop_id),
            due_date=None,
            due_at=leg["due_at"] if leg else transfer.get("due_at"),
            route_leg_id=leg["id"] if leg else None,
            start_stage=leg["stage_from"] if leg else None,
            actor_id=UUID(actor_id) if actor_id else None,
        )
        results.append({
            "order_item_id": str(item_id),
            "route_leg_id": str(leg["id"]) if leg else None,
            "assignment_id": allocation.assignment_id,
            "workshop_id": allocation.workshop_id,
            "current_stage": allocation.current_stage,
            "due_at": allocation.due_at,
        })

    await transfer_repo.set_status(
        session, transfer["id"], "received", stamp_column="received_at"
    )
    await transfer_repo.insert_event(
        session, transfer_id=transfer["id"], kind="received", actor_id=actor_id,
        media_id=media_id, note=note,
    )
    await transfer_repo.record_audit(
        session, transfer_id=transfer["id"], action="receive", actor_id=actor_id,
        payload={
            "transfer_no": transfer["transfer_no"],
            "to_workshop_id": to_workshop_id,
            "items": [r["order_item_id"] for r in results],
        },
    )
    logger.info(
        "Handover %s received at workshop %s (%d item(s))",
        transfer["transfer_no"], to_workshop_id, len(results),
    )
    return results


async def cancel_transfer(
    session: AsyncSession,
    *,
    transfer: dict,
    lines: list[dict],
    actor_id: str | None,
    reason: str,
) -> None:
    """Abandon a consignment: the goods never left, or they came straight back.

    Every destination leg returns to `pending` and the leg that was completed at the
    origin is REOPENED to `active`, because the item is physically still there and its
    manager must be able to keep working. The `received`/`cancelled` status then clears
    the transit lock through sync_transfer_denorm().
    """
    for line in lines:
        leg_id = line.get("route_leg_id")
        if leg_id is None:
            continue
        leg = await route_repo.get_leg(session, leg_id)
        if leg is None:
            continue
        await route_repo.set_leg_status(session, leg["id"], "pending")
        if leg["seq"] > 1:
            previous = await route_repo.leg_by_seq(
                session, leg["order_item_id"], leg["seq"] - 1
            )
            if previous is not None and previous["status"] == "completed":
                await route_repo.set_leg_status(session, previous["id"], "active")

    await transfer_repo.set_status(
        session, transfer["id"], "cancelled", stamp_column="cancelled_at",
        cancel_reason=reason,
    )
    await transfer_repo.insert_event(
        session, transfer_id=transfer["id"], kind="cancelled", actor_id=actor_id,
        note=reason,
    )
    await transfer_repo.record_audit(
        session, transfer_id=transfer["id"], action="cancel", actor_id=actor_id,
        payload={"transfer_no": transfer["transfer_no"], "reason": reason},
    )
    logger.info("Handover %s cancelled: %s", transfer["transfer_no"], reason)
