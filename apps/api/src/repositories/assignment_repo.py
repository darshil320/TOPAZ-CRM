"""Assignment repository — primary salesperson lookup for a customer."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..services import roles


class ConsentWithdrawn(Exception):
    """The customer withdrew consent; they cannot be handed to anyone (DPDPA)."""


async def get_primary_salesperson(
    session: AsyncSession,
    customer_id: UUID,
) -> tuple[UUID, str] | None:
    """Return (salesperson_id, whatsapp_e164) for the active primary assignment, or None.

    Joins salespersons to ensure the salesperson is active (not terminated/left).
    """
    result = await session.execute(
        text(
            "SELECT sp.id, sp.whatsapp"
            " FROM customer_assignments ca"
            " JOIN salespersons sp ON sp.id = ca.salesperson_id"
            " WHERE ca.customer_id = :cid"
            "   AND ca.role = 'primary'"
            "   AND ca.active = true"
            "   AND sp.active = true"
            " LIMIT 1"
        ),
        {"cid": str(customer_id)},
    )
    row = result.first()
    if not row:
        return None
    return UUID(str(row.id)), str(row.whatsapp)


async def get_selling_staff(session: AsyncSession, salesperson_id: UUID) -> dict | None:
    """{id, name} of an ACTIVE staff member who can own customers and quotations
    (roles.SELLING), else None — the target check for assign and quote-on-behalf."""
    result = await session.execute(
        text(
            "SELECT id, name FROM salespersons"
            " WHERE id = :id AND active = true AND role = ANY(:roles)"
        ),
        {"id": str(salesperson_id), "roles": sorted(roles.SELLING)},
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def ensure_assigned(
    session: AsyncSession, *, customer_id: UUID, salesperson_id: UUID, added_by: UUID
) -> str:
    """Make sure `salesperson_id` is actively on this customer, so a quotation prepared
    for them is visible to them (q_select is assignment-scoped). Returns what happened:
    'existing', 'primary' (nobody held the customer) or 'collaborator'.

    Never displaces an existing primary: primary only when nobody holds the customer
    (it is then claimed on the salesperson's behalf and leaves the walk-in queue), else
    collaborator. A primary insert that loses a race to a concurrent claim
    (one_active_primary_per_customer) falls back to collaborator, inside a savepoint so
    the caller's transaction survives the unique violation.

    Raises LookupError when the customer does not exist, ConsentWithdrawn when their
    consent was withdrawn — nobody may be handed such a customer (DPDPA).
    """
    current = await session.execute(
        text(
            "SELECT 1 FROM customer_assignments"
            " WHERE customer_id = :cid AND salesperson_id = :sid AND active = true"
        ),
        {"cid": str(customer_id), "sid": str(salesperson_id)},
    )
    if current.first() is not None:
        return "existing"
    role = await _role_for_new_assignment(session, customer_id)
    try:
        async with session.begin_nested():
            await _upsert_assignment(session, customer_id, salesperson_id, added_by, role)
    except IntegrityError as exc:
        # Only a lost primary race falls back; any other integrity error is real.
        if role != "primary" or "one_active_primary_per_customer" not in str(exc.orig):
            raise
        role = "collaborator"
        await _upsert_assignment(session, customer_id, salesperson_id, added_by, role)
    return role


async def _role_for_new_assignment(session: AsyncSession, customer_id: UUID) -> str:
    row = (await session.execute(
        text(
            "SELECT customer_has_active_primary(c.id) AS claimed,"
            "       (co.withdrawn_at IS NOT NULL) AS withdrawn"
            " FROM customers c JOIN consents co ON co.id = c.consent_id WHERE c.id = :cid"
        ),
        {"cid": str(customer_id)},
    )).mappings().first()
    if row is None:
        raise LookupError(f"customer {customer_id} not found")
    if row["withdrawn"]:
        raise ConsentWithdrawn(f"customer {customer_id} withdrew consent")
    return "collaborator" if row["claimed"] else "primary"


async def _upsert_assignment(
    session: AsyncSession, customer_id: UUID, salesperson_id: UUID, added_by: UUID, role: str
) -> None:
    # unique (customer_id, salesperson_id): an old inactive row is reactivated, not duplicated.
    await session.execute(
        text(
            "INSERT INTO customer_assignments (customer_id, salesperson_id, role, active, added_by)"
            " VALUES (:cid, :sid, :role, true, :by)"
            " ON CONFLICT (customer_id, salesperson_id)"
            " DO UPDATE SET active = true, role = EXCLUDED.role, added_by = EXCLUDED.added_by"
        ),
        {"cid": str(customer_id), "sid": str(salesperson_id), "role": role, "by": str(added_by)},
    )
