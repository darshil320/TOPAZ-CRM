"""Inter-workshop transfers — the mediator's consignments (module 14, migration 0031).

Raw SQL on an AsyncSession; caller owns the transaction.

MONEY-BLIND: every read here is safe to hand a `delivery`-role courier or an outside
vendor's lead. No function selects unit_price/line_total/gst_rate, and none may ever
start to — those roles have no order_items SELECT policy, so this projection IS their
boundary and the API runs on the service-role connection where RLS does not apply.

The status machine is enforced in api/transfers.py (one legal predecessor set per
edge); this module moves rows and appends events.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import audit_repo

_FIELDS = (
    "id", "transfer_no", "from_workshop_id", "to_workshop_id", "reason", "status",
    "courier_salesperson_id", "vehicle_no", "expected_pickup_at", "due_at",
    "picked_up_at", "delivered_at", "received_at", "cancelled_at", "cancel_reason",
    "notes", "created_by", "created_at", "updated_at",
)
_COLUMNS = ", ".join(_FIELDS)
_COLUMNS_T = ", ".join(f"t.{f}" for f in _FIELDS)

# Statuses in which the goods are still somewhere between the two workshops. Mirrors
# the `open` denorm the 0031 trigger maintains — kept here as a named constant so the
# API's guards read the same set the DB does.
OPEN_STATUSES = ("ready", "picked_up", "in_transit", "delivered")


async def create_transfer(
    session: AsyncSession,
    *,
    transfer_no: str,
    from_workshop_id: str | UUID,
    to_workshop_id: str | UUID,
    reason: str,
    due_at: datetime | None,
    expected_pickup_at: datetime | None,
    courier_salesperson_id: str | UUID | None,
    notes: str | None,
    actor_id: str | UUID | None,
) -> dict:
    result = await session.execute(
        text(
            "INSERT INTO workshop_transfers"
            " (transfer_no, from_workshop_id, to_workshop_id, reason, due_at,"
            "  expected_pickup_at, courier_salesperson_id, notes, created_by)"
            " VALUES (:no, :from_ws, :to_ws, :reason, :due, :pickup,"
            "         cast(:courier as uuid), :notes, cast(:actor as uuid))"
            f" RETURNING {_COLUMNS}"
        ),
        {
            "no": transfer_no, "from_ws": str(from_workshop_id), "to_ws": str(to_workshop_id),
            "reason": reason, "due": due_at, "pickup": expected_pickup_at,
            "courier": str(courier_salesperson_id) if courier_salesperson_id else None,
            "notes": notes, "actor": str(actor_id) if actor_id else None,
        },
    )
    return dict(result.mappings().one())


async def add_item(
    session: AsyncSession,
    *,
    transfer_id: str | UUID,
    order_item_id: str | UUID,
    route_leg_id: str | UUID | None,
    qty: float | None,
) -> dict:
    """Put one item on a consignment.

    Raises IntegrityError (workshop_transfer_items_one_open) if the item is already on
    an open transfer — the API maps that to 409 rather than upserting, because the
    honest outcome is "somebody already sent this, refresh".
    """
    result = await session.execute(
        text(
            "INSERT INTO workshop_transfer_items"
            " (transfer_id, order_item_id, route_leg_id, qty)"
            " VALUES (:t, :item, cast(:leg as uuid), :qty)"
            " RETURNING id, transfer_id, order_item_id, route_leg_id, qty, open, created_at"
        ),
        {
            "t": str(transfer_id), "item": str(order_item_id),
            "leg": str(route_leg_id) if route_leg_id else None, "qty": qty,
        },
    )
    return dict(result.mappings().one())


async def lock_transfer(session: AsyncSession, transfer_id: UUID) -> dict | None:
    """SELECT ... FOR UPDATE on the consignment.

    Taken by every state edge. Receive is the one that matters: it activates the next
    leg and rewrites custody, and two destination leads tapping Receive on the same
    tempo is a real race on a shared handset.
    """
    result = await session.execute(
        text(f"SELECT {_COLUMNS} FROM workshop_transfers WHERE id = :id FOR UPDATE"),
        {"id": str(transfer_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def get_transfer(session: AsyncSession, transfer_id: UUID) -> dict | None:
    """One consignment, with both workshops' names, addresses and lead phone numbers —
    everything the courier's run card renders, in one query."""
    result = await session.execute(
        text(
            f"SELECT {_COLUMNS_T},"
            "       fw.name AS from_workshop_name, fw.address AS from_workshop_address,"
            "       fw.manager_phone AS from_workshop_phone,"
            "       tw.name AS to_workshop_name, tw.address AS to_workshop_address,"
            "       tw.manager_phone AS to_workshop_phone,"
            "       cp.name AS courier_name, cp.whatsapp AS courier_whatsapp"
            " FROM workshop_transfers t"
            " JOIN workshops fw ON fw.id = t.from_workshop_id"
            " JOIN workshops tw ON tw.id = t.to_workshop_id"
            " LEFT JOIN salespersons cp ON cp.id = t.courier_salesperson_id"
            " WHERE t.id = :id"
        ),
        {"id": str(transfer_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def transfer_items(session: AsyncSession, transfer_id: UUID) -> list[dict]:
    """The consignment's lines — money-blind. `thumb_key` is the item's newest ready
    photo so the courier can recognise the goods without reading anything."""
    result = await session.execute(
        text(
            "SELECT ti.id, ti.order_item_id, ti.route_leg_id, ti.qty, ti.open,"
            "       oi.description, oi.unit, oi.dimensions, oi.material, oi.spec_notes,"
            "       oi.current_stage,"
            "       o.order_no, c.name AS customer_name,"
            "       (SELECT m.thumb_key FROM media m"
            "         WHERE m.entity_type = 'order_item' AND m.entity_id = oi.id"
            "           AND m.status = 'ready' AND m.thumb_key IS NOT NULL"
            "         ORDER BY m.created_at DESC LIMIT 1) AS thumb_key"
            " FROM workshop_transfer_items ti"
            " JOIN order_items oi ON oi.id = ti.order_item_id"
            " JOIN orders o ON o.id = oi.order_id"
            " JOIN customers c ON c.id = o.customer_id"
            " WHERE ti.transfer_id = :id ORDER BY oi.sort, oi.description"
        ),
        {"id": str(transfer_id)},
    )
    return [dict(m) for m in result.mappings().all()]


async def lock_transfer_items(session: AsyncSession, transfer_id: UUID) -> list[dict]:
    """The consignment's item ids + leg backlinks, locked. The receive transaction's
    first read: it must not see a line appear or vanish while it activates legs."""
    result = await session.execute(
        text(
            "SELECT id, order_item_id, route_leg_id FROM workshop_transfer_items"
            " WHERE transfer_id = :id ORDER BY created_at FOR UPDATE"
        ),
        {"id": str(transfer_id)},
    )
    return [dict(m) for m in result.mappings().all()]


async def set_status(
    session: AsyncSession,
    transfer_id: UUID,
    status: str,
    *,
    stamp_column: str | None = None,
    cancel_reason: str | None = None,
) -> dict | None:
    """Move the consignment's status and stamp the matching timestamp.

    `stamp_column` is checked against a WHITELIST before it reaches the SQL — it comes
    from this module's own call sites today, but a column name interpolated into a
    statement is the kind of thing that survives a refactor into a request field.
    """
    allowed = {"picked_up_at", "delivered_at", "received_at", "cancelled_at"}
    sets = ["status = :status"]
    if stamp_column is not None:
        if stamp_column not in allowed:
            raise ValueError(f"refusing to stamp unknown column '{stamp_column}'")
        sets.append(f"{stamp_column} = coalesce({stamp_column}, now())")
    if cancel_reason is not None:
        sets.append("cancel_reason = :reason")
    result = await session.execute(
        text(f"UPDATE workshop_transfers SET {', '.join(sets)} WHERE id = :id"
             f" RETURNING {_COLUMNS}"),
        {"id": str(transfer_id), "status": status, "reason": cancel_reason},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def assign_courier(
    session: AsyncSession,
    transfer_id: UUID,
    *,
    courier_salesperson_id: str | UUID | None,
    vehicle_no: str | None,
    expected_pickup_at: datetime | None,
) -> dict | None:
    result = await session.execute(
        text(
            "UPDATE workshop_transfers SET courier_salesperson_id = cast(:courier as uuid),"
            "   vehicle_no = coalesce(:vehicle, vehicle_no),"
            "   expected_pickup_at = coalesce(:pickup, expected_pickup_at)"
            f" WHERE id = :id RETURNING {_COLUMNS}"
        ),
        {
            "id": str(transfer_id),
            "courier": str(courier_salesperson_id) if courier_salesperson_id else None,
            "vehicle": vehicle_no, "pickup": expected_pickup_at,
        },
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def insert_event(
    session: AsyncSession,
    *,
    transfer_id: str | UUID,
    kind: str,
    note: str | None = None,
    media_id: str | UUID | None = None,
    actor_id: str | UUID | None = None,
) -> str:
    result = await session.execute(
        text(
            "INSERT INTO workshop_transfer_events (transfer_id, kind, note, media_id, actor)"
            " VALUES (:t, :kind, :note, cast(:media as uuid), cast(:actor as uuid))"
            " RETURNING id"
        ),
        {
            "t": str(transfer_id), "kind": kind, "note": note,
            "media": str(media_id) if media_id else None,
            "actor": str(actor_id) if actor_id else None,
        },
    )
    return str(result.scalar_one())


async def transfer_events(session: AsyncSession, transfer_id: UUID) -> list[dict]:
    result = await session.execute(
        text(
            "SELECT e.id, e.kind, e.note, e.media_id, e.at, p.name AS actor_name,"
            "       m.storage_key, m.thumb_key"
            " FROM workshop_transfer_events e"
            " LEFT JOIN salespersons p ON p.id = e.actor"
            " LEFT JOIN media m ON m.id = e.media_id"
            " WHERE e.transfer_id = :id ORDER BY e.at DESC"
        ),
        {"id": str(transfer_id)},
    )
    return [dict(m) for m in result.mappings().all()]


async def open_transfer_for_item(session: AsyncSession, order_item_id: UUID) -> dict | None:
    """The consignment an item is currently on, if any. Reads through the `open`
    denorm the 0031 trigger owns, so it agrees with order_items.transit_transfer_id
    by construction."""
    result = await session.execute(
        text(
            f"SELECT {_COLUMNS_T} FROM workshop_transfer_items ti"
            " JOIN workshop_transfers t ON t.id = ti.transfer_id"
            " WHERE ti.order_item_id = :item AND ti.open = true"
        ),
        {"item": str(order_item_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def list_transfers(
    session: AsyncSession,
    *,
    courier_salesperson_id: str | UUID | None = None,
    workshop_id: str | UUID | None = None,
    direction: str | None = None,
    statuses: tuple[str, ...] = OPEN_STATUSES,
    limit: int = 100,
) -> list[dict]:
    """Filtered consignment list with item counts.

    `direction` ('in' | 'out' | None) only applies alongside `workshop_id`: 'in' is the
    destination's Incoming screen, 'out' the origin's Sent list, None is both.
    `statuses` is bound as a Postgres array, never string-joined.
    """
    where = ["t.status = any(:statuses)"]
    params: dict = {"statuses": list(statuses), "limit": limit}
    if courier_salesperson_id is not None:
        where.append("t.courier_salesperson_id = cast(:courier as uuid)")
        params["courier"] = str(courier_salesperson_id)
    if workshop_id is not None:
        params["ws"] = str(workshop_id)
        if direction == "in":
            where.append("t.to_workshop_id = cast(:ws as uuid)")
        elif direction == "out":
            where.append("t.from_workshop_id = cast(:ws as uuid)")
        else:
            where.append("(t.to_workshop_id = cast(:ws as uuid)"
                         " OR t.from_workshop_id = cast(:ws as uuid))")
    result = await session.execute(
        text(
            f"SELECT {_COLUMNS_T},"
            "       fw.name AS from_workshop_name, fw.address AS from_workshop_address,"
            "       fw.manager_phone AS from_workshop_phone,"
            "       tw.name AS to_workshop_name, tw.address AS to_workshop_address,"
            "       tw.manager_phone AS to_workshop_phone,"
            "       cp.name AS courier_name,"
            "       (SELECT count(*) FROM workshop_transfer_items ti"
            "         WHERE ti.transfer_id = t.id) AS item_count"
            " FROM workshop_transfers t"
            " JOIN workshops fw ON fw.id = t.from_workshop_id"
            " JOIN workshops tw ON tw.id = t.to_workshop_id"
            " LEFT JOIN salespersons cp ON cp.id = t.courier_salesperson_id"
            f" WHERE {' AND '.join(where)}"
            " ORDER BY t.expected_pickup_at NULLS LAST, t.due_at NULLS LAST, t.created_at"
            " LIMIT :limit"
        ),
        params,
    )
    return [dict(m) for m in result.mappings().all()]


async def stale_pickups(session: AsyncSession, *, limit: int = 100) -> list[dict]:
    """Consignments still sitting at `ready` past their pickup window — the second
    watchdog signal. Served by workshop_transfers_pickup_idx."""
    result = await session.execute(
        text(
            f"SELECT {_COLUMNS_T}, fw.name AS from_workshop_name, tw.name AS to_workshop_name"
            " FROM workshop_transfers t"
            " JOIN workshops fw ON fw.id = t.from_workshop_id"
            " JOIN workshops tw ON tw.id = t.to_workshop_id"
            " WHERE t.status = 'ready' AND t.expected_pickup_at IS NOT NULL"
            "   AND t.expected_pickup_at < now()"
            " ORDER BY t.expected_pickup_at LIMIT :limit"
        ),
        {"limit": limit},
    )
    return [dict(m) for m in result.mappings().all()]


async def record_audit(
    session: AsyncSession, *, transfer_id: str | UUID, action: str,
    actor_id: str | UUID | None, payload: dict,
) -> None:
    await audit_repo.record(
        session, entity="workshop_transfers", entity_id=transfer_id, action=action,
        actor=actor_id, payload=payload,
    )
