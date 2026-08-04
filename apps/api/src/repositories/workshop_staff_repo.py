"""Workshop staff roster — the lead/sub hierarchy (module 14, migration 0029).

Raw SQL on an AsyncSession; caller owns the transaction.

Two invariants this module is responsible for, both backed by a partial unique index
so a caller that skips the helper still cannot corrupt the roster:

  * ONE active lead per workshop (`workshop_staff_one_active_lead`). Promotion is
    therefore deactivate-then-insert, never a bare UPDATE — `set_role` below does the
    pair in the caller's transaction.
  * No duplicate membership per (workshop, person) (`workshop_staff_one_active_person`).

Roster rows are DEACTIVATED, never deleted: they are the audit trail behind every
stage tap the person made.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import audit_repo

_FIELDS = (
    "id", "workshop_id", "salesperson_id", "role", "active",
    "created_by", "created_at", "updated_at", "deactivated_at",
)
_COLUMNS = ", ".join(_FIELDS)


async def staff_role_at(
    session: AsyncSession, *, salesperson_id: str | UUID, workshop_id: str | UUID
) -> str | None:
    """'lead' | 'sub' | None — the caller's capability at ONE workshop.

    Feeds services/stage_flow.capabilities_for(), which is where the actual
    permission decision is made. Deliberately returns None rather than raising for a
    non-member: "not on this roster" is a normal answer, not an error.
    """
    result = await session.execute(
        text(
            "SELECT s.role FROM workshop_staff s JOIN workshops w ON w.id = s.workshop_id"
            " WHERE s.workshop_id = :ws AND s.salesperson_id = :sp"
            "   AND s.active = true AND w.active = true"
        ),
        {"ws": str(workshop_id), "sp": str(salesperson_id)},
    )
    row = result.first()
    return None if row is None else str(row[0])


async def my_workshops(session: AsyncSession, salesperson_id: str | UUID) -> list[dict]:
    """Active workshops this person is staff of, with their role at each.

    Runs on every load of the workshop PWA — served by workshop_staff_person_idx.
    """
    result = await session.execute(
        text(
            "SELECT w.id, w.name, w.type, w.address, s.role AS staff_role"
            " FROM workshop_staff s JOIN workshops w ON w.id = s.workshop_id"
            " WHERE s.salesperson_id = :sp AND s.active = true AND w.active = true"
            " ORDER BY lower(w.name)"
        ),
        {"sp": str(salesperson_id)},
    )
    return [dict(m) for m in result.mappings().all()]


async def list_staff(session: AsyncSession, workshop_id: UUID, *, active_only: bool = True) -> list[dict]:
    """The roster of one workshop, joined to the person's name/phone so the admin tab
    needs a single query. Leads first, then subs alphabetically."""
    result = await session.execute(
        text(
            f"SELECT {', '.join(f's.{f}' for f in _FIELDS)},"
            "       p.name AS salesperson_name, p.whatsapp AS salesperson_whatsapp,"
            "       p.role AS salesperson_role, p.active AS salesperson_active"
            " FROM workshop_staff s JOIN salespersons p ON p.id = s.salesperson_id"
            " WHERE s.workshop_id = :ws AND (:active_only = false OR s.active = true)"
            " ORDER BY s.active DESC, (s.role = 'lead') DESC, lower(p.name)"
        ),
        {"ws": str(workshop_id), "active_only": active_only},
    )
    return [dict(m) for m in result.mappings().all()]


async def list_staff_all(
    session: AsyncSession, *, active_only: bool = True
) -> dict[str, list[dict]]:
    """EVERY workshop's roster in ONE query, keyed by workshop id.

    The admin tab shows a roster card per workshop. Asking for them one workshop at a
    time meant one HTTP call → one caller verification → one query EACH, so the page
    got slower with every workshop the business added. Same rows, same order, one
    round-trip.

    A workshop with an empty roster is absent from the map; the caller renders "no
    staff yet" from the workshop list it already has, which is where the set of
    workshops belongs anyway.
    """
    result = await session.execute(
        text(
            f"SELECT {', '.join(f's.{f}' for f in _FIELDS)},"
            "       p.name AS salesperson_name, p.whatsapp AS salesperson_whatsapp,"
            "       p.role AS salesperson_role, p.active AS salesperson_active"
            " FROM workshop_staff s"
            " JOIN salespersons p ON p.id = s.salesperson_id"
            " JOIN workshops w ON w.id = s.workshop_id"
            " WHERE (:active_only = false OR s.active = true)"
            # Same ordering as list_staff, with workshop as the outer key so the
            # grouping below preserves it.
            " ORDER BY s.workshop_id, s.active DESC, (s.role = 'lead') DESC, lower(p.name)"
        ),
        {"active_only": active_only},
    )
    rosters: dict[str, list[dict]] = {}
    for row in result.mappings().all():
        entry = dict(row)
        rosters.setdefault(str(entry["workshop_id"]), []).append(entry)
    return rosters


async def get_membership(
    session: AsyncSession, *, workshop_id: UUID, salesperson_id: UUID
) -> dict | None:
    result = await session.execute(
        text(f"SELECT {_COLUMNS} FROM workshop_staff"
             " WHERE workshop_id = :ws AND salesperson_id = :sp AND active = true"),
        {"ws": str(workshop_id), "sp": str(salesperson_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def deactivate_lead(session: AsyncSession, workshop_id: UUID) -> dict | None:
    """Retire the current active lead, if there is one. Returns the retired row.

    Called immediately before appointing a new lead, in the SAME transaction:
    workshop_staff_one_active_lead is a plain (non-deferrable) partial unique index,
    so the order of the two statements is what makes promotion possible at all.
    """
    result = await session.execute(
        text(
            "UPDATE workshop_staff SET active = false, deactivated_at = now()"
            " WHERE workshop_id = :ws AND active = true AND role = 'lead'"
            f" RETURNING {_COLUMNS}"
        ),
        {"ws": str(workshop_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def deactivate_membership(
    session: AsyncSession, *, workshop_id: UUID, salesperson_id: UUID
) -> dict | None:
    result = await session.execute(
        text(
            "UPDATE workshop_staff SET active = false, deactivated_at = now()"
            " WHERE workshop_id = :ws AND salesperson_id = :sp AND active = true"
            f" RETURNING {_COLUMNS}"
        ),
        {"ws": str(workshop_id), "sp": str(salesperson_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def add_staff(
    session: AsyncSession,
    *,
    workshop_id: UUID,
    salesperson_id: UUID,
    role: str,
    actor_id: str | UUID | None,
) -> dict:
    """Appoint someone to a workshop.

    When `role='lead'` the caller MUST have called deactivate_lead() first — this
    function does not do it implicitly, because "silently demote whoever was lead" is
    exactly the kind of hidden side effect that should be a deliberate, audited step
    in the API route (api/workshops.py), not a surprise inside a repo helper.
    """
    result = await session.execute(
        text(
            "INSERT INTO workshop_staff (workshop_id, salesperson_id, role, created_by)"
            " VALUES (:ws, :sp, :role, :actor)"
            f" RETURNING {_COLUMNS}"
        ),
        {
            "ws": str(workshop_id), "sp": str(salesperson_id), "role": role,
            "actor": str(actor_id) if actor_id else None,
        },
    )
    row = dict(result.mappings().one())
    await audit_repo.record(
        session, entity="workshop_staff", entity_id=row["id"], action="add",
        actor=actor_id,
        payload={"workshop_id": str(workshop_id), "salesperson_id": str(salesperson_id),
                 "role": role},
    )
    return row


async def lead_contact(session: AsyncSession, workshop_id: UUID) -> dict | None:
    """The active lead's name + WhatsApp — module 12's notification recipient, and the
    tap-to-call number the courier app shows. Falls back to the workshop's own
    `manager_name`/`manager_phone` (0023) when no lead has a login yet: a vendor
    workshop with no app user still has to be reachable.
    """
    result = await session.execute(
        text(
            "SELECT coalesce(p.name, w.manager_name) AS name,"
            "       coalesce(p.whatsapp, w.manager_phone) AS whatsapp,"
            "       p.id AS salesperson_id, w.name AS workshop_name, w.address"
            " FROM workshops w"
            " LEFT JOIN workshop_staff s"
            "        ON s.workshop_id = w.id AND s.active = true AND s.role = 'lead'"
            " LEFT JOIN salespersons p ON p.id = s.salesperson_id AND p.active = true"
            " WHERE w.id = :ws"
        ),
        {"ws": str(workshop_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)
