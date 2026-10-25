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

from ..services import roles

# Roles that may write any customer's quotes/orders (no assignment needed).
_QUOTE_ORDER_ADMIN = roles.VIEW_ALL

# Roles that may read any customer's financial documents (receipts/payments),
# regardless of assignment — accounts handle collections across all customers.
_FINANCE_READ_ANY = roles.VIEW_ALL | {"accounts"}

# Roles that may read the documents of customers ASSIGNED to them. A telecaller sees
# everything a salesperson sees (0051); writes stay salesperson-only.
_ASSIGNED_READ_ROLES = {"salesperson", "telecaller"}

# Roles that may edit ANY lead's fields, not only leads they captured. A telecaller
# (0051) works the whole enquiry list by phone; admin edits everything (0052). Delete
# is narrower — see assert_can_delete_lead.
_LEAD_EDIT_ANY = roles.VIEW_ALL | {"telecaller"}

# Roles that may write a quotation for ANY customer without being assigned — the
# front desk prepares quotations on a salesperson's behalf (0052). Quotations only:
# orders, job cards and production stay on assert_can_write_customer.
_QUOTE_WRITE_ANY = _QUOTE_ORDER_ADMIN | {"front_desk"}


@dataclass(frozen=True)
class Caller:
    salesperson_id: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role in _QUOTE_ORDER_ADMIN

    @property
    def is_owner(self) -> bool:
        return self.role in roles.OWNER_LEVEL


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
    """Owner-level/admin may write any customer's quote/order; a salesperson only their
    assigned customers. Everyone else (accounts/workshop/delivery) is refused."""
    if caller.is_admin:
        return
    if caller.role == "salesperson" and await _is_assigned(session, caller.salesperson_id, customer_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to write this customer's records")


async def assert_can_write_quote(session: AsyncSession, caller: Caller, customer_id: str) -> None:
    """assert_can_write_customer, plus the front desk for any customer (0052)."""
    if caller.role in _QUOTE_WRITE_ANY:
        return
    await assert_can_write_customer(session, caller, customer_id)


async def assert_can_read_quote(session: AsyncSession, caller: Caller, customer_id: str) -> None:
    """assert_can_read_customer, plus the front desk for any quotation (0052) — it
    prepares and shares them. Quotations only: receipts and challans stay as they were."""
    if caller.role in _QUOTE_WRITE_ANY:
        return
    await assert_can_read_customer(session, caller, customer_id)


def assert_admin(caller: Caller, *, action: str) -> None:
    """Owner/admin-only gate. `action` is folded into the 403 so the message tells
    the user what was refused, not just that something was."""
    if not caller.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"Only owner/admin may {action}")


def assert_dispatcher(caller: Caller, *, action: str) -> None:
    """Owner-level, admin or front desk — who may assign walk-ins (0052)."""
    if caller.role not in roles.DISPATCH:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"Only the front desk, an admin or the owner may {action}")


def assert_may_remove(caller: Caller, *, action: str) -> None:
    """Refuse a removal — delete, deactivate, retire, cancel — to the roles that may
    never remove anything (admin, 0052). Called BEFORE the route's own gate, so the
    403 says why rather than "not authorized"."""
    if caller.role in roles.NO_REMOVAL:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"Admins can view and edit but cannot {action}")


def assert_role(caller: Caller, roles_: set[str], *, action: str) -> None:
    """Membership gate for the non-admin role sets (accounts, workshop_manager…)."""
    if caller.role not in roles_:
        allowed = "/".join(sorted(roles_))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"Only {allowed} may {action}")


def _is_lead_creator(caller: Caller, lead: dict) -> bool:
    created_by = lead.get("created_by")
    return created_by is not None and str(created_by) == caller.salesperson_id


def assert_can_edit_lead(caller: Caller, lead: dict, *, action: str = "edit this lead") -> None:
    """The salesperson who captured the lead, owner-level, admin or a telecaller.

    The owner/creator half mirrors the leads_update policy (0047). The telecaller and
    admin halves are API-only on purpose — RLS is NOT widened for them (see 0051's
    header), so this gate plus the LeadUpdate field whitelist is the only place they
    are granted. RLS does not run on the service-role connection the API uses.

    A lead whose created_by is NULL (captured before the API recorded a creator, and
    with no assignee for 0047 to backfill from) is editable only by the any-lead
    roles — the safe default.
    """
    if caller.role in _LEAD_EDIT_ANY or _is_lead_creator(caller, lead):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Only the person who captured this lead, the owner, an admin or a telecaller may {action}",
    )


def assert_can_delete_lead(caller: Caller, lead: dict, *, action: str = "delete this lead") -> None:
    """Creator or owner-level — never a telecaller or an admin, not even on their own.

    Covers deleting the lead and deleting its call recordings. A telecaller edits
    every lead (0051), so letting them delete would put the whole enquiry list —
    the denominator of the owner's conversion rate — one click from gone. An admin
    removes nothing (0052).
    """
    if caller.role == "telecaller":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"A telecaller can edit leads but cannot {action}",
        )
    assert_may_remove(caller, action=action)
    if caller.is_owner or _is_lead_creator(caller, lead):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Only the person who captured this lead, or the owner, may {action}",
    )


def assert_can_clear_notification(
    caller: Caller, notification: dict, *, action: str = "clear this notification"
) -> None:
    """A follow-up notification belongs to the salesperson it was created for; the
    owner may clear any. Same shape as assert_can_edit_lead, but scoped to the
    notification row's own salesperson_id (fixed at creation time) rather than a
    lead's created_by, since a notification's "owner" and a lead's creator are
    different concepts that happen to often be the same person."""
    if caller.is_owner:
        return
    if str(notification.get("salesperson_id")) == caller.salesperson_id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Only the salesperson this notification belongs to, or the owner, may {action}",
    )


async def capabilities_at_workshop(
    session: AsyncSession, caller: Caller, workshop_id: str | None
) -> frozenset[str]:
    """What this caller may do AT ONE WORKSHOP (module 14's lead/sub split).

    Resolves the caller's `workshop_staff.role` there and hands both roles to the pure
    rule in services/stage_flow.capabilities_for(). Owner/admin and the courier role do
    not depend on a roster row, so the lookup is skipped for them — a `delivery` user
    driving a consignment must not need to be on either workshop's staff list.

    Every OTHER role gets the lookup, whatever its coarse role string is: 0029 makes the
    roster the authority on what you may do at a workshop, so gating the lookup itself on
    `role == 'workshop_manager'` silently discarded the roster row of a sub-manager whose
    `salespersons.role` was still 'salesperson'.
    """
    from ..repositories import workshop_staff_repo
    from ..services import stage_flow

    staff_role: str | None = None
    if workshop_id and caller.role not in stage_flow.ROSTER_IRRELEVANT_ROLES:
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
    """Read access to a customer's documents (receipts, challans, quotation PDFs):
    owner/admin/accounts may read any; a salesperson or telecaller only their
    assigned customers."""
    if caller.role in _FINANCE_READ_ANY:
        return
    if caller.role in _ASSIGNED_READ_ROLES and await _is_assigned(
        session, caller.salesperson_id, customer_id
    ):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to view this customer's records")
