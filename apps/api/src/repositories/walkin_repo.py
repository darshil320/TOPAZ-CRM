"""Walk-in assignment (0052) — the front desk hands an unclaimed customer straight to a
salesperson, from the kiosk at sign-up or from the front desk board.

Assigning IS claiming on the salesperson's behalf: it creates their primary assignment,
so the customer leaves everyone's walk-in queue and lands in that salesperson's
customers. Walk-ins nobody assigns stay in every salesperson's queue, exactly as before.
Service-role writes only — the API's authz.assert_dispatcher is the gate.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

# 0002's partial unique index: one active primary per customer.
_PRIMARY_INDEX = "one_active_primary_per_customer"


async def get_walkin_state(session: AsyncSession, customer_id: UUID) -> dict | None:
    """{id, name, primary_name, consent_withdrawn} — primary_name is the salesperson who
    already holds the customer (None while unclaimed); consent_withdrawn means their
    personal-data consent was withdrawn, so staff must not hand them to anyone.
    None if the customer does not exist."""
    result = await session.execute(
        text(
            "SELECT c.id, c.name,"
            "       (SELECT sp.name FROM customer_assignments ca"
            "          JOIN salespersons sp ON sp.id = ca.salesperson_id"
            "         WHERE ca.customer_id = c.id AND ca.role = 'primary' AND ca.active = true"
            "         LIMIT 1) AS primary_name,"
            "       (co.withdrawn_at IS NOT NULL) AS consent_withdrawn"
            " FROM customers c JOIN consents co ON co.id = c.consent_id"
            " WHERE c.id = :id"
        ),
        {"id": str(customer_id)},
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def assign_primary(
    session: AsyncSession, *, customer_id: UUID, salesperson_id: UUID, assigned_by: UUID
) -> bool:
    """Make `salesperson_id` the customer's primary. False when somebody claimed it first.

    The one_active_primary_per_customer index arbitrates, exactly like claim_customer();
    the insert runs in a savepoint so the loser's unique violation leaves the caller's
    transaction usable. An old inactive row for the same pair is reactivated — unique
    (customer_id, salesperson_id) would otherwise refuse it.
    """
    try:
        async with session.begin_nested():
            await session.execute(
                text(
                    "INSERT INTO customer_assignments"
                    " (customer_id, salesperson_id, role, active, added_by)"
                    " VALUES (:cid, :sid, 'primary', true, :by)"
                    " ON CONFLICT (customer_id, salesperson_id)"
                    " DO UPDATE SET role = 'primary', active = true, added_by = EXCLUDED.added_by"
                ),
                {"cid": str(customer_id), "sid": str(salesperson_id), "by": str(assigned_by)},
            )
    except IntegrityError as exc:
        # Only the primary-uniqueness race is "somebody claimed it first"; any other
        # integrity failure (FK, check) is a real error and must not read as a race.
        if _PRIMARY_INDEX not in str(exc.orig):
            raise
        return False
    return True
