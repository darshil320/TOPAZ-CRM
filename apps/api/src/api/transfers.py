"""Inter-workshop transfer API — the mediator app's backend (module 14).

    POST /api/transfers                       lead(from)/owner/admin — open a consignment
    POST /api/transfers/{id}/assign           lead/owner/admin — courier + vehicle + window
    POST /api/transfers/{id}/pickup           courier or lead(from) — PHOTO REQUIRED
    POST /api/transfers/{id}/in-transit       courier or lead(from)
    POST /api/transfers/{id}/deliver          courier or lead(from) — PHOTO REQUIRED
    POST /api/transfers/{id}/receive          lead(to)/owner/admin — THE custody transaction
    POST /api/transfers/{id}/cancel           lead(from)/owner/admin — reason required
    GET  /api/transfers/my                    the courier's open runs (money-blind)
    GET  /api/transfers/{id}                  one run: both sites, contacts, items, events
    GET  /api/transfers?workshop_id=&direction=in|out

─── The status machine ────────────────────────────────────────────────────────
    ready ──pickup──▶ picked_up ──in-transit──▶ in_transit ──deliver──▶ delivered
                                                                           │
                                                          receive (destination lead)
                                                                           ▼
                                                                       received
    any open state ──cancel──▶ cancelled

Each edge names its legal predecessors explicitly — no "any forward move" shortcut,
because the two states that matter (`delivered` and `received`) are asserted by
DIFFERENT PEOPLE and that is the whole point of the design (module 14 D10). Only
`received` moves custody.

`receive` is allowed from `delivered` OR `in_transit`: the courier's phone dies often
enough that "the tempo is here, he never tapped Delivered" must not strand the goods.
It is NOT allowed from `ready`/`picked_up` — the destination cannot receive something
that has not left.

─── MONEY ─────────────────────────────────────────────────────────────────────
Every response body here is money-blind. The courier is a `delivery`-role user with no
order_items SELECT policy; this API runs on the service-role connection where RLS does
not apply, so these projections are the boundary. The paperwork that travels with the
goods is the existing job_card_pdf (0027), money-free by construction.
"""

import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from ..database import make_task_session
from ..repositories import (
    production_repo,
    route_repo,
    transfer_repo,
    workshop_staff_repo,
)
from ..services import handover, stage_flow
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/transfers", dependencies=[Depends(require_dashboard_key)])

# Legal predecessors, per edge. The single source of truth for "can this happen now".
_EDGES: dict[str, tuple[str, ...]] = {
    "assign": ("ready", "picked_up", "in_transit"),
    "pickup": ("ready",),
    "in_transit": ("picked_up",),
    "deliver": ("picked_up", "in_transit"),
    "receive": ("in_transit", "delivered"),
    "cancel": ("ready", "picked_up", "in_transit", "delivered"),
}


class TransferCreate(BaseModel):
    order_item_ids: list[UUID] = Field(min_length=1, max_length=50)
    to_workshop_id: UUID | None = None
    reason: str = Field(default="next_stage", pattern="^(next_stage|rework|capacity|other)$")
    courier_salesperson_id: UUID | None = None
    expected_pickup_at: datetime | None = None
    due_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=500)


class AssignRequest(BaseModel):
    courier_salesperson_id: UUID | None = None
    vehicle_no: str | None = Field(default=None, max_length=32)
    expected_pickup_at: datetime | None = None


class HandoverStepRequest(BaseModel):
    media_id: UUID | None = None
    note: str | None = Field(default=None, max_length=500)
    vehicle_no: str | None = Field(default=None, max_length=32)


class CancelRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _assert_edge(transfer: dict, edge: str) -> None:
    allowed = _EDGES[edge]
    if transfer["status"] not in allowed:
        raise _conflict(
            f"Consignment {transfer['transfer_no']} is '{transfer['status']}' — "
            f"{edge.replace('_', ' ')} needs it to be {' or '.join(allowed)}"
        )


async def _load_or_404(session, transfer_id: UUID, *, lock: bool = True) -> dict:
    transfer = (
        await transfer_repo.lock_transfer(session, transfer_id) if lock
        else await transfer_repo.get_transfer(session, transfer_id)
    )
    if transfer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consignment not found")
    return transfer


async def _assert_may_move_goods(session, caller, transfer: dict) -> None:
    """Who may drive a consignment down the road: the assigned courier, any courier if
    none is assigned yet, the ORIGIN's lead (a vendor sending its own tempo), or
    owner/admin."""
    if caller.is_admin:
        return
    assigned = transfer.get("courier_salesperson_id")
    if caller.role == "delivery":
        if assigned is None or str(assigned) == caller.salesperson_id:
            return
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="This consignment is assigned to another courier")
    caps = await authz.capabilities_at_workshop(
        session, caller, str(transfer["from_workshop_id"])
    )
    authz.assert_capability(caps, stage_flow.CAP_CUSTODY, action="move this consignment")


async def _assert_custody_at(session, caller, workshop_id: str, action: str) -> None:
    caps = await authz.capabilities_at_workshop(session, caller, workshop_id)
    authz.assert_capability(caps, stage_flow.CAP_CUSTODY, action=action)


def _notify(kind: str, **payload) -> None:
    """Fire-and-forget. Swallowed and logged: a broker hiccup must not roll back a
    handover the courier has already been told succeeded (same call the production
    router and the payments router make)."""
    try:
        from ..tasks.production_notify import notify_transfer_event

        notify_transfer_event.delay(kind, payload)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not enqueue transfer %s notification (%s): %s", kind, payload, exc)


# ─── Reads ───────────────────────────────────────────────────────────────────
@router.get("/my")
async def my_runs(caller_uid: str = Depends(get_caller_uid)) -> dict:
    """The courier's open runs, each with its items — the mediator app's home screen.

    A courier with nothing assigned gets an empty list, not a 403: "no runs today" is a
    normal state and the app must render it rather than an error.
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        caps = stage_flow.capabilities_for(role=caller.role, staff_role=None)
        if stage_flow.CAP_TRANSIT not in caps:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Your role does not carry goods between workshops")
        runs = await transfer_repo.list_transfers(
            session,
            courier_salesperson_id=None if caller.is_admin else caller.salesperson_id,
        )
        for run in runs:
            run["items"] = await transfer_repo.transfer_items(session, UUID(str(run["id"])))
    return {"transfers": runs}


@router.get("/{transfer_id}")
async def get_transfer(transfer_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        transfer = await _load_or_404(session, transfer_id, lock=False)
        await _assert_can_read(session, caller, transfer)
        items = await transfer_repo.transfer_items(session, transfer_id)
        events = await transfer_repo.transfer_events(session, transfer_id)
    return {"transfer": transfer, "items": items, "events": events}


async def _assert_can_read(session, caller, transfer: dict) -> None:
    """Mirrors the wt_select RLS policy (0031) in code, because this router runs on the
    service-role connection where that policy does not apply. Keeping the two in step is
    deliberate: the browser and the API must not disagree about who can see a run."""
    if caller.is_admin:
        return
    if caller.role == "delivery":
        assigned = transfer.get("courier_salesperson_id")
        if assigned is not None and str(assigned) == caller.salesperson_id:
            return
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Not authorized to view this consignment")
    for side in ("from_workshop_id", "to_workshop_id"):
        role = await workshop_staff_repo.staff_role_at(
            session, salesperson_id=caller.salesperson_id, workshop_id=str(transfer[side])
        )
        if role is not None:
            return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to view this consignment")


@router.get("")
async def list_transfers(
    workshop_id: UUID | None = None,
    direction: str | None = None,
    include_closed: bool = False,
    caller_uid: str = Depends(get_caller_uid),
) -> dict:
    if direction not in (None, "in", "out"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="direction must be 'in' or 'out'")
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        if workshop_id is not None and not caller.is_admin:
            role = await workshop_staff_repo.staff_role_at(
                session, salesperson_id=caller.salesperson_id, workshop_id=str(workshop_id)
            )
            if role is None:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                    detail="You are not staff of that workshop")
        if workshop_id is None and not caller.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Specify a workshop_id you are staff of")
        statuses = (
            transfer_repo.OPEN_STATUSES + ("received", "cancelled")
            if include_closed else transfer_repo.OPEN_STATUSES
        )
        rows = await transfer_repo.list_transfers(
            session, workshop_id=workshop_id, direction=direction, statuses=statuses,
        )
    return {"transfers": rows}


# ─── Writes ──────────────────────────────────────────────────────────────────
@router.post("", status_code=status.HTTP_201_CREATED)
async def create_transfer(req: TransferCreate,
                          caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Open a consignment by hand — the lead-only manual override of the automatic
    handover (module 14 D6).

    Every item must currently be at the SAME workshop (they are going in one tempo) and
    none may already be on an open consignment. The destination defaults to each item's
    next route leg; `to_workshop_id` overrides it, which is how a `rework` send-back or
    a `capacity` reshuffle is expressed without inventing a route.
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)

        items: list[dict] = []
        for item_id in req.order_item_ids:
            item = await production_repo.lock_item_for_event(session, item_id)
            if item is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                    detail=f"Order item {item_id} not found")
            if item["workshop_id"] is None:
                raise _conflict("An item that is not at a workshop cannot be sent anywhere")
            if item["production_done_at"] is not None:
                raise _conflict("An item that has finished production cannot be transferred")
            if item["transit_transfer_id"] is not None:
                raise _conflict(
                    f"Item '{item['description']}' is already on an open consignment"
                )
            items.append(item)

        origins = {str(i["workshop_id"]) for i in items}
        if len(origins) > 1:
            raise _conflict(
                "These items are at different workshops — one consignment leaves from "
                "one place. Create a consignment per workshop."
            )
        from_workshop_id = origins.pop()
        await _assert_custody_at(session, caller, from_workshop_id,
                                 "hand goods over from this workshop")

        # Destination: explicit, else each item's next leg (which must agree).
        destinations: set[str] = set()
        next_legs: dict[str, dict | None] = {}
        for item in items:
            leg_seq = item.get("leg_seq")
            nxt = (
                await route_repo.leg_by_seq(session, item["id"], int(leg_seq) + 1)
                if leg_seq is not None else None
            )
            next_legs[str(item["id"])] = nxt
            if req.to_workshop_id is None and nxt is not None:
                destinations.add(str(nxt["workshop_id"]))

        if req.to_workshop_id is not None:
            to_workshop_id = str(req.to_workshop_id)
        elif len(destinations) == 1:
            to_workshop_id = destinations.pop()
        elif not destinations:
            raise _conflict(
                "These items have no next route leg — plan a route first, or name a "
                "destination workshop explicitly"
            )
        else:
            raise _conflict(
                "These items' routes send them to different workshops — send them "
                "separately or name one destination"
            )

        if to_workshop_id == from_workshop_id:
            raise _conflict("The destination is the workshop the goods are already at")
        row = await session.execute(
            text("SELECT name, active FROM workshops WHERE id = cast(:id as uuid)"),
            {"id": to_workshop_id},
        )
        dest = row.mappings().first()
        if dest is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Destination workshop not found")
        if not dest["active"]:
            raise _conflict(f"Workshop '{dest['name']}' is inactive")

        # One consignment, N lines. The first item opens it (and closes its leg); the
        # rest are appended, so a single tempo carrying four chairs is ONE run on the
        # courier's phone rather than four.
        first = items[0]
        first_leg = next_legs[str(first["id"])]
        try:
            transfer = await handover.open_handover(
                session,
                order_item_id=first["id"],
                from_workshop_id=from_workshop_id,
                to_workshop_id=to_workshop_id,
                completed_leg_id=str(first["leg_id"]) if first.get("leg_id") else None,
                destination_leg_id=str(first_leg["id"]) if first_leg else None,
                due_at=req.due_at or (first_leg["due_at"] if first_leg else None),
                actor_id=caller.salesperson_id,
                reason=req.reason,
                courier_salesperson_id=(
                    str(req.courier_salesperson_id) if req.courier_salesperson_id else None
                ),
                expected_pickup_at=req.expected_pickup_at,
                notes=req.notes,
                qty=float(first["qty"]) if first["qty"] is not None else None,
            )
            for item in items[1:]:
                leg = next_legs[str(item["id"])]
                if item.get("leg_id"):
                    await route_repo.set_leg_status(
                        session, str(item["leg_id"]), "completed", stamp_completed=True
                    )
                if leg is not None:
                    await route_repo.set_leg_status(session, str(leg["id"]), "in_transit")
                await transfer_repo.add_item(
                    session, transfer_id=transfer["id"], order_item_id=item["id"],
                    route_leg_id=str(leg["id"]) if leg else None,
                    qty=float(item["qty"]) if item["qty"] is not None else None,
                )
        except IntegrityError as exc:
            logger.info("Concurrent consignment for items %s: %s", req.order_item_ids, exc)
            raise _conflict(
                "One of these items was put on a consignment concurrently — refresh and retry"
            ) from exc

        await session.commit()

    _notify("created", transfer_id=str(transfer["id"]))
    return {"transfer": transfer, "item_count": len(items)}


@router.post("/{transfer_id}/assign")
async def assign(transfer_id: UUID, req: AssignRequest,
                 caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        transfer = await _load_or_404(session, transfer_id)
        _assert_edge(transfer, "assign")
        await _assert_custody_at(session, caller, str(transfer["from_workshop_id"]),
                                 "assign a courier to this consignment")
        if req.courier_salesperson_id is not None:
            row = await session.execute(
                text("SELECT role, active FROM salespersons WHERE id = cast(:id as uuid)"),
                {"id": str(req.courier_salesperson_id)},
            )
            courier = row.mappings().first()
            if courier is None or not courier["active"]:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                    detail="Courier staff record not found or inactive")
            # Not a hard role check on 'delivery' alone: a small showroom's own floor
            # manager legitimately drives the tempo. But accounts must never appear on
            # a courier list, so the set is explicit.
            if courier["role"] not in ("delivery", "workshop_manager", "owner", "admin"):
                raise _conflict(
                    f"A '{courier['role']}' cannot be assigned to carry goods"
                )
        updated = await transfer_repo.assign_courier(
            session, transfer_id,
            courier_salesperson_id=req.courier_salesperson_id,
            vehicle_no=req.vehicle_no,
            expected_pickup_at=req.expected_pickup_at,
        )
        await transfer_repo.insert_event(
            session, transfer_id=transfer_id, kind="assigned",
            actor_id=caller.salesperson_id,
            note=f"vehicle {req.vehicle_no}" if req.vehicle_no else None,
        )
        await transfer_repo.record_audit(
            session, transfer_id=transfer_id, action="assign",
            actor_id=caller.salesperson_id,
            payload={"courier_salesperson_id": str(req.courier_salesperson_id)
                     if req.courier_salesperson_id else None,
                     "vehicle_no": req.vehicle_no},
        )
        await session.commit()
    _notify("assigned", transfer_id=str(transfer_id))
    return updated


@router.post("/{transfer_id}/pickup")
async def pickup(transfer_id: UUID, req: HandoverStepRequest,
                 caller_uid: str = Depends(get_caller_uid)) -> dict:
    """The courier has the goods. A photo is REQUIRED: this frame is the origin's proof
    of the condition the goods left in, and the only defence in a damage argument
    (the same reasoning that made `dispatch` photo_required in 0024)."""
    return await _handover_step(
        transfer_id, req, caller_uid, edge="pickup", new_status="picked_up",
        stamp="picked_up_at", event="picked_up", require_media=True,
    )


@router.post("/{transfer_id}/in-transit")
async def in_transit(transfer_id: UUID, req: HandoverStepRequest,
                     caller_uid: str = Depends(get_caller_uid)) -> dict:
    return await _handover_step(
        transfer_id, req, caller_uid, edge="in_transit", new_status="in_transit",
        stamp=None, event="in_transit", require_media=False,
    )


@router.post("/{transfer_id}/deliver")
async def deliver(transfer_id: UUID, req: HandoverStepRequest,
                  caller_uid: str = Depends(get_caller_uid)) -> dict:
    """The courier says the goods are at the destination. Custody does NOT move here —
    the destination lead's Receive does that."""
    return await _handover_step(
        transfer_id, req, caller_uid, edge="deliver", new_status="delivered",
        stamp="delivered_at", event="delivered", require_media=True,
    )


async def _handover_step(
    transfer_id: UUID,
    req: HandoverStepRequest,
    caller_uid: str,
    *,
    edge: str,
    new_status: str,
    stamp: str | None,
    event: str,
    require_media: bool,
) -> dict:
    if require_media and req.media_id is None:
        raise _conflict(
            f"A handover photo is required to mark this consignment '{new_status}'"
        )
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        transfer = await _load_or_404(session, transfer_id)
        _assert_edge(transfer, edge)
        await _assert_may_move_goods(session, caller, transfer)

        if req.vehicle_no:
            await transfer_repo.assign_courier(
                session, transfer_id, courier_salesperson_id=transfer.get("courier_salesperson_id"),
                vehicle_no=req.vehicle_no, expected_pickup_at=None,
            )
        updated = await transfer_repo.set_status(
            session, transfer_id, new_status, stamp_column=stamp
        )
        await transfer_repo.insert_event(
            session, transfer_id=transfer_id, kind=event, note=req.note,
            media_id=req.media_id, actor_id=caller.salesperson_id,
        )
        await transfer_repo.record_audit(
            session, transfer_id=transfer_id, action=event, actor_id=caller.salesperson_id,
            payload={"media_id": str(req.media_id) if req.media_id else None},
        )
        await session.commit()
    _notify(event, transfer_id=str(transfer_id))
    return updated


@router.post("/{transfer_id}/receive")
async def receive(transfer_id: UUID, req: HandoverStepRequest,
                  caller_uid: str = Depends(get_caller_uid)) -> dict:
    """THE custody transaction — the destination lead confirms the goods arrived.

    In one commit: activate each item's destination leg, write a new active assignment
    at this workshop (which flips order_items.workshop_id through the 0024 denorm
    trigger), flip the consignment to `received` (which clears the transit lock through
    the 0031 trigger, making the items advanceable again).

    Lead-only (module 14 D4): a sub-manager updates status, a lead accepts custody.
    A handover photo is required — the receiving end's record of what actually turned up.
    """
    if req.media_id is None:
        raise _conflict("A photo of the goods as received is required")
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        transfer = await _load_or_404(session, transfer_id)
        _assert_edge(transfer, "receive")
        await _assert_custody_at(session, caller, str(transfer["to_workshop_id"]),
                                 "receive goods at this workshop")

        lines = await transfer_repo.lock_transfer_items(session, transfer_id)
        if not lines:
            raise _conflict("This consignment has no items on it")
        try:
            results = await handover.receive_transfer(
                session, transfer=transfer, lines=lines,
                actor_id=caller.salesperson_id, media_id=str(req.media_id), note=req.note,
            )
        except IntegrityError as exc:
            logger.info("Concurrent receive on consignment %s: %s", transfer_id, exc)
            raise _conflict("This consignment was received concurrently — refresh") from exc
        await session.commit()

    _notify("received", transfer_id=str(transfer_id))
    return {
        "transfer_id": str(transfer_id),
        "transfer_no": transfer["transfer_no"],
        "status": "received",
        "items": [
            {**r, "due_at": r["due_at"].isoformat() if r["due_at"] else None}
            for r in results
        ],
    }


@router.post("/{transfer_id}/cancel")
async def cancel(transfer_id: UUID, req: CancelRequest,
                 caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Abandon a consignment. Every destination leg goes back to `pending` and the
    origin's leg is reopened, because the goods are physically still there and its
    manager must be able to keep working."""
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        transfer = await _load_or_404(session, transfer_id)
        _assert_edge(transfer, "cancel")
        await _assert_custody_at(session, caller, str(transfer["from_workshop_id"]),
                                 "cancel this consignment")
        lines = await transfer_repo.lock_transfer_items(session, transfer_id)
        await handover.cancel_transfer(
            session, transfer=transfer, lines=lines, actor_id=caller.salesperson_id,
            reason=req.reason,
        )
        await session.commit()
    _notify("cancelled", transfer_id=str(transfer_id))
    return {"transfer_id": str(transfer_id), "status": "cancelled", "reason": req.reason}
