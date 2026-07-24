"""Server-side authorization for the write routes.

Identity comes from the verified JWT (deps.get_caller_uid → auth_uid); this module
resolves it to a salesperson (id + role) and enforces the write matrix in code —
the RLS policies do NOT apply on the service-role connection the API uses, so this
layer is the authorization boundary (security-review HIGH-3/HIGH-4).
"""

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Roles that may write any customer's quotes/orders (no assignment needed).
_QUOTE_ORDER_ADMIN = {"owner", "admin"}


@dataclass(frozen=True)
class Caller:
    salesperson_id: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role in _QUOTE_ORDER_ADMIN


async def resolve_caller(session: AsyncSession, auth_uid: str) -> Caller:
    """Map a verified auth uid to an active salesperson. 403 if none."""
    row = await session.execute(
        text("SELECT id, role FROM salespersons WHERE auth_uid = :uid AND active = true"),
        {"uid": auth_uid},
    )
    r = row.mappings().first()
    if r is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No active staff record")
    return Caller(salesperson_id=str(r["id"]), role=str(r["role"]))


async def _is_assigned(session: AsyncSession, salesperson_id: str, customer_id: str) -> bool:
    row = await session.execute(
        text(
            "SELECT 1 FROM customer_assignments"
            " WHERE customer_id = :cid AND salesperson_id = :sid AND active = true LIMIT 1"
        ),
        {"cid": str(customer_id), "sid": salesperson_id},
    )
    return row.first() is not None


async def assert_can_write_customer(session: AsyncSession, caller: Caller, customer_id: str) -> None:
    """Owner/admin may write any customer's quote/order; a salesperson only their
    assigned customers. Everyone else (accounts/workshop/delivery) is refused."""
    if caller.is_admin:
        return
    if caller.role == "salesperson" and await _is_assigned(session, caller.salesperson_id, customer_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to write this customer's records")
