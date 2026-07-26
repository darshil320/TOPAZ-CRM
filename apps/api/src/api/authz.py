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

# Roles that may read any customer's financial documents (receipts/payments),
# regardless of assignment — accounts handle collections across all customers.
_FINANCE_READ_ANY = {"owner", "admin", "accounts"}


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


def assert_admin(caller: Caller, *, action: str) -> None:
    """Owner/admin-only gate. `action` is folded into the 403 so the message tells
    the user what was refused, not just that something was."""
    if not caller.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"Only owner/admin may {action}")


def assert_role(caller: Caller, roles: set[str], *, action: str) -> None:
    """Membership gate for the non-admin role sets (accounts, workshop_manager…)."""
    if caller.role not in roles:
        allowed = "/".join(sorted(roles))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"Only {allowed} may {action}")


async def capabilities_at_workshop(
    session: AsyncSession, caller: Caller, workshop_id: str | None
) -> frozenset[str]:
    """What this caller may do AT ONE WORKSHOP (module 14's lead/sub split).

    Resolves the caller's `workshop_staff.role` there and hands both roles to the pure
    rule in services/stage_flow.capabilities_for(). Owner/admin and the courier role do
    not depend on a roster row, so the lookup is skipped for them — a `delivery` user
    driving a consignment must not need to be on either workshop's staff list.
    """
    from ..repositories import workshop_staff_repo
    from ..services import stage_flow

    staff_role: str | None = None
    if workshop_id and caller.role == "workshop_manager":
        staff_role = await workshop_staff_repo.staff_role_at(
            session, salesperson_id=caller.salesperson_id, workshop_id=workshop_id
        )
    return stage_flow.capabilities_for(role=caller.role, staff_role=staff_role)


def assert_capability(caps: frozenset[str], cap: str, *, action: str) -> None:
    """403 unless the capability is present. `action` is folded into the message so a
    sub-manager who taps Receive is told what is missing, not just that it failed."""
    if cap not in caps:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You are not authorized to {action} at this workshop",
        )


async def assert_can_read_customer(session: AsyncSession, caller: Caller, customer_id: str) -> None:
    """Read access to a customer's financial documents (receipts): owner/admin/
    accounts may read any; a salesperson only their assigned customers."""
    if caller.role in _FINANCE_READ_ANY:
        return
    if caller.role == "salesperson" and await _is_assigned(session, caller.salesperson_id, customer_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to view this customer's records")
