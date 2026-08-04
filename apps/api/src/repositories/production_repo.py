"""Production repository — allocation (module 08) + the stage machine (module 09).

Raw SQL on an AsyncSession; caller owns the transaction.

Module 09 added `stage_defs`, `lock_item_for_event`, `insert_event`,
`item_production_state` and `queue_for_workshop`. All of the DECISIONS those feed
(stage order, leg boundaries, photo rules, who may tap what) live in
services/stage_flow.py so they are testable without a database; this module only
reads and writes rows.

MONEY: `queue_for_workshop` and `item_production_state` are money-BLIND projections
by construction — they never select unit_price/line_total/gst_rate. That is not
politeness, it is the boundary: `workshop_manager` and `delivery` have (and must keep)
no SELECT policy on order_items (0024:118), so these projections are the only path
those roles have to production data, and adding a price column here would hand it to
them through the service-role connection where RLS does not apply.
"""

from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from . import audit_repo

# Money-blind item columns, in one place so the queue read, the item read and the
# courier's read cannot drift apart — and so adding a column is a visible diff on a
# line that says why it must not be a price.
_ITEM_COLUMNS = (
    "oi.id, oi.description, oi.qty, oi.unit, oi.dimensions, oi.material,"
    " oi.spec_notes, oi.current_stage, oi.current_stage_at, oi.blocked, oi.blocked_at,"
    " oi.production_done_at, oi.workshop_id, oi.transit_transfer_id, oi.order_id"
)


@dataclass(frozen=True)
class Allocation:
    assignment_id: str
    order_item_id: str
    workshop_id: str
    due_date: date | None
    current_stage: str | None
    previous_workshop_id: str | None
    due_at: datetime | None = None
    route_leg_id: str | None = None


async def lock_item(session: AsyncSession, order_item_id: UUID) -> dict | None:
    """SELECT ... FOR UPDATE on the order_item row.

    This is the allocation invariant's primary serialisation: it makes the
    deactivate-then-insert pair atomic against a concurrent allocation of the same
    item, so the second caller queues and then produces a clean re-allocation
    instead of racing into two active rows. Same lock discipline as the payments
    over-payment TOCTOU fix (payment_repo.lock_order).
    """
    result = await session.execute(
        text(
            "SELECT oi.id, oi.order_id, oi.current_stage, oi.workshop_id,"
            "       oi.production_done_at, o.status AS order_status, o.customer_id"
            " FROM order_items oi JOIN orders o ON o.id = oi.order_id"
            " WHERE oi.id = :id FOR UPDATE OF oi"
        ),
        {"id": str(order_item_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def first_stage_code(session: AsyncSession) -> str | None:
    result = await session.execute(
        text("SELECT code FROM production_stage_defs WHERE active = true ORDER BY sort LIMIT 1")
    )
    row = result.first()
    return None if row is None else str(row[0])


async def allocate(
    session: AsyncSession,
    *,
    order_item_id: UUID,
    workshop_id: UUID,
    due_date: date | None,
    actor_id: UUID | None,
    due_at: datetime | None = None,
    route_leg_id: UUID | str | None = None,
    start_stage: str | None = None,
) -> Allocation:
    """Assign an item to a workshop: retire any prior assignment, insert the new
    one, refresh the denorm, audit it.

    The caller MUST have taken lock_item() first. The partial unique index
    order_item_assignments_one_active is the DB backstop — a caller that reaches
    the INSERT without the lock raises unique_violation, which the API maps to 409
    (we do NOT use ON CONFLICT: the desired outcome is an error, not an upsert, and
    claim_customer() already sets the house precedent of catching the violation
    rather than trusting arbiter inference against a partial index).

    Allocation emits NO production_event and does NOT touch orders.status — the
    status flip happens on the first `done`, per the transition map.

    Module 14 added three optional arguments, all additive so the module-08 allocate
    route keeps its exact behaviour:
      due_at       — the deadline WITH a time. Writing it lets the 0030 trigger derive
                     due_date, so never pass both for the same deadline.
      route_leg_id — which leg of the item's route produced this custody record.
      start_stage  — the stage to begin at when the item has none yet. Used when a
                     route's first leg starts mid-chain (a re-route of an item already
                     three stages in). Still coalesced, so it can never rewind an item.
    """
    prior = await session.execute(
        text(
            "UPDATE order_item_assignments SET active = false, deactivated_at = now()"
            " WHERE order_item_id = :item AND active = true"
            " RETURNING id, workshop_id"
        ),
        {"item": str(order_item_id)},
    )
    prior_row = prior.mappings().first()
    previous_workshop_id = str(prior_row["workshop_id"]) if prior_row else None

    inserted = await session.execute(
        text(
            "INSERT INTO order_item_assignments"
            " (order_item_id, workshop_id, due_date, due_at, route_leg_id, assigned_by, active)"
            " VALUES (:item, :workshop, :due, :due_at, cast(:leg as uuid), :actor, true)"
            " RETURNING id, due_date, due_at"
        ),
        {
            "item": str(order_item_id), "workshop": str(workshop_id), "due": due_date,
            "due_at": due_at, "leg": str(route_leg_id) if route_leg_id else None,
            "actor": str(actor_id) if actor_id else None,
        },
    )
    inserted_row = inserted.mappings().one()
    assignment_id = str(inserted_row["id"])
    # Read back rather than echoing the input: the 0030 trigger derives due_date from
    # due_at in Asia/Kolkata, and the caller must be told the date the DB actually
    # holds, not the one it guessed.
    stored_due_date = inserted_row["due_date"]
    stored_due_at = inserted_row["due_at"]

    # First-stage initialisation. current_stage is set HERE, never by the event
    # trigger: picking a starting stage is a business decision, not an event
    # consequence (0024 header). coalesce so a re-allocation mid-production never
    # rewinds an item that is already three stages in.
    #
    # order_items.workshop_id is deliberately NOT written here — the
    # order_item_assignments_sync_denorm trigger owns it, so there is exactly one
    # writer and the denorm cannot drift from the active assignment row.
    updated = await session.execute(
        text(
            "UPDATE order_items SET"
            "   current_stage    = coalesce(current_stage, :start_stage,"
            "       (SELECT code FROM production_stage_defs WHERE active = true"
            "         ORDER BY sort LIMIT 1)),"
            "   current_stage_at = coalesce(current_stage_at, now())"
            " WHERE id = :item RETURNING current_stage"
        ),
        {"item": str(order_item_id), "start_stage": start_stage},
    )
    current_stage = updated.scalar_one_or_none()

    await audit_repo.record(
        session,
        entity="order_item_assignments",
        entity_id=assignment_id,
        action="allocate",
        actor=actor_id,
        payload={
            "order_item_id": str(order_item_id),
            "workshop_id": str(workshop_id),
            "prior_workshop_id": previous_workshop_id,
            "due_date": stored_due_date.isoformat() if stored_due_date else None,
            "due_at": stored_due_at.isoformat() if stored_due_at else None,
            "route_leg_id": str(route_leg_id) if route_leg_id else None,
        },
    )

    return Allocation(
        assignment_id=assignment_id,
        order_item_id=str(order_item_id),
        workshop_id=str(workshop_id),
        due_date=stored_due_date,
        current_stage=str(current_stage) if current_stage else None,
        previous_workshop_id=previous_workshop_id,
        due_at=stored_due_at,
        route_leg_id=str(route_leg_id) if route_leg_id else None,
    )


async def active_assignment(session: AsyncSession, order_item_id: UUID) -> dict | None:
    result = await session.execute(
        text(
            "SELECT id, order_item_id, workshop_id, due_date, due_at, route_leg_id,"
            "       assigned_by, created_at"
            " FROM order_item_assignments WHERE order_item_id = :item AND active = true"
        ),
        {"item": str(order_item_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def unallocated_items(
    session: AsyncSession, *, salesperson_id: str | None = None, limit: int = 200
) -> list[dict]:
    """Items of confirmed/in-production orders with no workshop yet — the allocate
    page's queue. Served by order_items_unallocated_idx.

    `salesperson_id` scopes the queue to that person's assigned customers. It is
    passed for the `salesperson` role and omitted for owner/admin, mirroring the
    write path: allocate() already refuses an unassigned customer, so an unscoped
    read would list customer names and order contents a salesperson cannot act on.

    THE CAST APPEARS ON BOTH USES OF :sp AND MUST. asyncpg PREPARES the statement, so
    Postgres has to resolve every parameter's type before any value is bound — and a bare
    `:sp IS NULL` offers nothing to infer from. Postgres does not carry the type backwards
    from the `cast(:sp as uuid)` further down, so it gave up with
    `AmbiguousParameterError: could not determine data type of parameter $1` and the
    allocate page 500'd for EVERY caller. Casting at both sites pins the type once.
    """
    result = await session.execute(
        text(
            "SELECT oi.id, oi.description, oi.qty, oi.unit, oi.dimensions, oi.material,"
            "       oi.order_id, o.order_no, o.expected_delivery_date, o.status,"
            "       c.id AS customer_id, c.name AS customer_name"
            " FROM order_items oi"
            " JOIN orders o ON o.id = oi.order_id"
            " JOIN customers c ON c.id = o.customer_id"
            " WHERE oi.workshop_id IS NULL AND o.status IN ('confirmed', 'in_production')"
            "   AND (cast(:sp as uuid) IS NULL OR EXISTS ("
            "        SELECT 1 FROM customer_assignments ca"
            "         WHERE ca.customer_id = o.customer_id AND ca.active = true"
            "           AND ca.salesperson_id = cast(:sp as uuid)))"
            " ORDER BY o.expected_delivery_date NULLS LAST, o.created_at, oi.sort"
            " LIMIT :limit"
        ),
        {"limit": limit, "sp": salesperson_id},
    )
    return [dict(m) for m in result.mappings().all()]


# ════════════════════════════════════════════════════════════════════════════
# Module 09 — the stage machine
# ════════════════════════════════════════════════════════════════════════════
async def stage_defs(session: AsyncSession, *, active_only: bool = True) -> list[dict]:
    """The stage table, ordered. Fed straight into services/stage_flow.to_stages()."""
    result = await session.execute(
        text(
            "SELECT code, sort, label_en, label_gu, photo_required, active"
            " FROM production_stage_defs"
            " WHERE (:active_only = false OR active = true) ORDER BY sort"
        ),
        {"active_only": active_only},
    )
    return [dict(m) for m in result.mappings().all()]


async def lock_item_for_event(session: AsyncSession, order_item_id: UUID) -> dict | None:
    """SELECT ... FOR UPDATE on the item, returning everything the advance guards need.

    The lock is the concurrent-double-tap defence (a flaky phone network retries the
    same POST): the loser queues, re-reads a `current_stage` that has already moved,
    and its duplicate `done` hits production_events_one_done_per_stage → 409. Same
    lock discipline as lock_item() and payment_repo.lock_order().

    Also returns the ACTIVE ROUTE LEG, because two of the three module-14 guards read
    it (is the caller's workshop this leg's workshop; is the stage inside this leg's
    span) and fetching it separately would open a window where the leg changed under us.
    """
    result = await session.execute(
        text(
            f"SELECT {_ITEM_COLUMNS},"
            "       o.status AS order_status, o.order_no, o.customer_id,"
            "       leg.id AS leg_id, leg.seq AS leg_seq, leg.workshop_id AS leg_workshop_id,"
            "       leg.stage_from AS leg_stage_from, leg.stage_to AS leg_stage_to,"
            "       leg.due_at AS leg_due_at"
            " FROM order_items oi"
            " JOIN orders o ON o.id = oi.order_id"
            " LEFT JOIN order_item_route_legs leg"
            "        ON leg.order_item_id = oi.id AND leg.status = 'active'"
            " WHERE oi.id = :id FOR UPDATE OF oi"
        ),
        {"id": str(order_item_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def insert_event(
    session: AsyncSession,
    *,
    order_item_id: UUID,
    stage_code: str,
    kind: str,
    note: str | None = None,
    media_id: UUID | str | None = None,
    actor_id: UUID | str | None = None,
) -> str:
    """Append one production_event and return its id.

    Everything the event CAUSES — current_stage moving, the order status flip, the
    blocked flags — is done by production_event_apply() (0024). This function does not
    touch order_items, on purpose: two writers for `current_stage` is precisely the
    drift that made the old dashboard server action unsafe (module 14 §1.1).
    """
    result = await session.execute(
        text(
            "INSERT INTO production_events"
            " (order_item_id, stage_code, kind, note, media_id, actor)"
            " VALUES (:item, :stage, :kind, :note, cast(:media as uuid), cast(:actor as uuid))"
            " RETURNING id"
        ),
        {
            "item": str(order_item_id), "stage": stage_code, "kind": kind, "note": note,
            "media": str(media_id) if media_id else None,
            "actor": str(actor_id) if actor_id else None,
        },
    )
    return str(result.scalar_one())


async def item_production_state(session: AsyncSession, order_item_id: UUID) -> dict | None:
    """Money-blind production state of one item: the item, its order/customer labels,
    the active leg and the current custody record."""
    result = await session.execute(
        text(
            f"SELECT {_ITEM_COLUMNS},"
            "       o.order_no, o.status AS order_status, o.expected_delivery_date,"
            "       c.name AS customer_name,"
            "       w.name AS workshop_name,"
            "       a.due_at, a.due_date, a.route_leg_id,"
            "       leg.seq AS leg_seq, leg.stage_from AS leg_stage_from,"
            "       leg.stage_to AS leg_stage_to, leg.due_at AS leg_due_at,"
            "       leg.status AS leg_status"
            " FROM order_items oi"
            " JOIN orders o ON o.id = oi.order_id"
            " JOIN customers c ON c.id = o.customer_id"
            " LEFT JOIN workshops w ON w.id = oi.workshop_id"
            " LEFT JOIN order_item_assignments a"
            "        ON a.order_item_id = oi.id AND a.active = true"
            " LEFT JOIN order_item_route_legs leg"
            "        ON leg.order_item_id = oi.id AND leg.status = 'active'"
            " WHERE oi.id = :id"
        ),
        {"id": str(order_item_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def queue_for_workshop(
    session: AsyncSession, workshop_ids: list[str], *, limit: int = 300
) -> list[dict]:
    """A workshop's live queue — the PWA's My Queue, money-blind.

    Unfinished items whose CURRENT custody is one of these workshops. Ordered by
    deadline (soonest first, nulls last) then by how long the item has sat in its
    stage, so the card at the top of a manager's phone is the one that will hurt.

    `workshop_ids` is a Python list bound with expanding=True — never string-joined
    into the SQL.

    Handles a workshop with a NULL manager_salesperson_id correctly (a vendor with no
    login) because it scopes on the WORKSHOP, not on the manager: the owner/admin view
    passes every id and those items stay visible (STATE.md discovery for module 09).
    """
    if not workshop_ids:
        return []
    result = await session.execute(
        text(
            f"SELECT {_ITEM_COLUMNS},"
            "       o.order_no, o.expected_delivery_date,"
            "       c.name AS customer_name,"
            "       w.name AS workshop_name,"
            "       a.due_at, a.due_date,"
            "       leg.id AS leg_id, leg.seq AS leg_seq,"
            "       leg.stage_from AS leg_stage_from, leg.stage_to AS leg_stage_to,"
            "       leg.due_at AS leg_due_at,"
            "       (SELECT count(*) FROM order_item_route_legs l2"
            "         WHERE l2.order_item_id = oi.id AND l2.status <> 'cancelled') AS leg_total,"
            "       nextw.name AS next_workshop_name"
            " FROM order_items oi"
            " JOIN orders o ON o.id = oi.order_id"
            " JOIN customers c ON c.id = o.customer_id"
            " JOIN workshops w ON w.id = oi.workshop_id"
            " LEFT JOIN order_item_assignments a"
            "        ON a.order_item_id = oi.id AND a.active = true"
            " LEFT JOIN order_item_route_legs leg"
            "        ON leg.order_item_id = oi.id AND leg.status = 'active'"
            " LEFT JOIN order_item_route_legs nextleg"
            "        ON nextleg.order_item_id = oi.id AND nextleg.seq = leg.seq + 1"
            " LEFT JOIN workshops nextw ON nextw.id = nextleg.workshop_id"
            " WHERE oi.workshop_id IN :ws AND oi.production_done_at IS NULL"
            " ORDER BY coalesce(leg.due_at, a.due_at) NULLS LAST,"
            "          oi.current_stage_at NULLS LAST"
            " LIMIT :limit"
        ).bindparams(bindparam("ws", expanding=True)),
        {"ws": [str(w) for w in workshop_ids], "limit": limit},
    )
    return [dict(m) for m in result.mappings().all()]


async def item_events(session: AsyncSession, order_item_id: UUID, *, limit: int = 60) -> list[dict]:
    """The item's stage timeline for the history accordion, newest first.
    Served by production_events_item_at_idx."""
    result = await session.execute(
        text(
            "SELECT e.id, e.stage_code, e.kind, e.note, e.media_id, e.at,"
            "       p.name AS actor_name, m.storage_key, m.thumb_key"
            " FROM production_events e"
            " LEFT JOIN salespersons p ON p.id = e.actor"
            " LEFT JOIN media m ON m.id = e.media_id"
            " WHERE e.order_item_id = :item ORDER BY e.at DESC LIMIT :limit"
        ),
        {"item": str(order_item_id), "limit": limit},
    )
    return [dict(m) for m in result.mappings().all()]


async def record_override_audit(
    session: AsyncSession,
    *,
    order_item_id: UUID,
    actor_id: str | UUID | None,
    from_stage: str,
    to_stage: str,
    reason: str,
    skipped: list[str],
) -> None:
    """A stage override is the one production action with no physical evidence behind
    it, so it gets an audit_log row of its own on top of the `done` events. Written
    LOUDLY (module 09's spec) — the payload names every stage that was skipped."""
    await audit_repo.record(
        session, entity="order_items", entity_id=order_item_id, action="override_stage",
        actor=actor_id,
        payload={"from_stage": from_stage, "to_stage": to_stage, "reason": reason,
                 "skipped_stages": skipped},
    )


async def stage_done_codes(session: AsyncSession, order_item_id: UUID) -> set[str]:
    """Stages already marked done for this item. Lets the API reject a duplicate with
    a sentence instead of leaning on the unique-index 409, and drives the PWA's
    ticked-stage stepper."""
    result = await session.execute(
        text(
            "SELECT stage_code FROM production_events"
            " WHERE order_item_id = :item AND kind = 'done'"
        ),
        {"item": str(order_item_id)},
    )
    return {str(r[0]) for r in result.all()}
