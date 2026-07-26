"""Workshops API — admin CRUD, load hints, and the staff roster (08 + module 14).

Writes go through here rather than straight to Supabase (even though RLS would
allow the admin tab to write directly) because two rules cannot live in RLS: the
E.164 phone validation with a usable message, and the deactivation guard that
refuses to retire a workshop still holding live work.

Reads: the dashboard may query `workshops` directly under RLS; GET here exists for
the allocate modal, which also needs the open-item count.

There is NO delete endpoint, by design — workshops are deactivated (0023). Roster
rows are likewise deactivated, never deleted (0029).

─── MODULE 14: `manager_salesperson_id` IS NOW A DENORM ───────────────────────
`workshops.manager_salesperson_id` is maintained by 0029's sync_workshop_lead()
trigger from the `workshop_staff` roster. So this router NEVER writes that column
directly — a caller who supplies `manager_salesperson_id` gets a `lead` roster row
instead, and the trigger sets the column. Two writers would drift, and the drift is
load-bearing: is_workshop_manager_of() reads the ROSTER, so a workshop whose column
was set by hand would have a manager who cannot see their own queue. That was the
whole bug class the hierarchy introduced, and it is closed here rather than left to
every future caller to remember.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from ..database import make_task_session
from ..repositories import audit_repo
from ..repositories import workshop_repo as repo
from ..repositories import workshop_staff_repo as staff_repo
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workshops", dependencies=[Depends(require_dashboard_key)])

_E164 = r"^\+[1-9][0-9]{7,14}$"


class WorkshopCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: str = Field(default="own", pattern="^(own|vendor)$")
    manager_name: str | None = None
    manager_phone: str | None = Field(default=None, pattern=_E164)
    manager_salesperson_id: UUID | None = None
    address: str | None = None


class WorkshopPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    type: str | None = Field(default=None, pattern="^(own|vendor)$")
    manager_name: str | None = None
    manager_phone: str | None = Field(default=None, pattern=_E164)
    manager_salesperson_id: UUID | None = None
    address: str | None = None


def _duplicate_name(exc: IntegrityError, name: str | None) -> HTTPException:
    logger.info("Workshop name conflict for %r: %s", name, exc)
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"A workshop named '{name}' already exists",
    )


async def _check_manager(session, salesperson_id: UUID | None) -> None:
    if salesperson_id is None:
        return
    if not await repo.salesperson_exists(session, salesperson_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Manager staff record not found or inactive")


async def _appoint_lead(session, workshop_id: UUID, salesperson_id: UUID | None,
                        actor_id: str) -> None:
    """Make `salesperson_id` the workshop's lead, retiring whoever held it.

    Both statements in ONE transaction, in this order: workshop_staff_one_active_lead
    is a plain partial unique index, so appointing before retiring fails. A None
    salesperson just retires the incumbent (a workshop with no lead is a legal, if
    unhappy, state — a vendor site with no login has always been allocatable).
    """
    retired = await staff_repo.deactivate_lead(session, workshop_id)
    if salesperson_id is None:
        if retired is not None:
            await audit_repo.record(
                session, entity="workshop_staff", entity_id=retired["id"],
                action="retire_lead", actor=actor_id,
                payload={"workshop_id": str(workshop_id)},
            )
        return
    # If they were already a `sub` here, that row must go first: one active membership
    # per (workshop, person).
    existing = await staff_repo.get_membership(
        session, workshop_id=workshop_id, salesperson_id=salesperson_id
    )
    if existing is not None:
        await staff_repo.deactivate_membership(
            session, workshop_id=workshop_id, salesperson_id=salesperson_id
        )
    await staff_repo.add_staff(
        session, workshop_id=workshop_id, salesperson_id=salesperson_id,
        role="lead", actor_id=actor_id,
    )


@router.get("")
async def list_workshops(active: bool = True, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """All workshops (active by default) with `open_item_count`. Any active staff
    member may read — a workshop name carries no money."""
    async with make_task_session() as session:
        await authz.resolve_caller(session, caller_uid)
        rows = await repo.list_workshops(session, active_only=active)
    return {"workshops": rows}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workshop(req: WorkshopCreate, caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        authz.assert_admin(caller, action="manage workshops")
        await _check_manager(session, req.manager_salesperson_id)
        try:
            row = await repo.create_workshop(
                session, name=req.name.strip(), type_=req.type,
                manager_name=req.manager_name, manager_phone=req.manager_phone,
                # NOT passed through: the roster owns this column (module 14). Set via
                # _appoint_lead below so the trigger writes it and a roster row exists.
                manager_salesperson_id=None, address=req.address,
            )
        except IntegrityError as exc:
            raise _duplicate_name(exc, req.name) from exc
        if req.manager_salesperson_id is not None:
            await _appoint_lead(session, UUID(str(row["id"])), req.manager_salesperson_id,
                                caller.salesperson_id)
            row = await repo.get_workshop(session, UUID(str(row["id"]))) or row
        await audit_repo.record(
            session, entity="workshops", entity_id=row["id"], action="create",
            actor=caller.salesperson_id, payload={"name": row["name"], "type": row["type"]},
        )
        await session.commit()
    logger.info("Created workshop %s (%s)", row["id"], row["name"])
    return row


@router.patch("/{workshop_id}")
async def patch_workshop(workshop_id: UUID, req: WorkshopPatch,
                         caller_uid: str = Depends(get_caller_uid)) -> dict:
    changes = req.model_dump(exclude_unset=True)
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        authz.assert_admin(caller, action="manage workshops")
        appoint_lead = "manager_salesperson_id" in changes
        if appoint_lead:
            await _check_manager(session, req.manager_salesperson_id)
            # Stripped from the direct UPDATE: the roster + trigger own this column.
            changes.pop("manager_salesperson_id")
        if "name" in changes and changes["name"]:
            changes["name"] = changes["name"].strip()
        try:
            row = await repo.update_workshop(session, workshop_id, changes)
        except IntegrityError as exc:
            raise _duplicate_name(exc, changes.get("name")) from exc
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workshop not found")
        if appoint_lead:
            await _appoint_lead(session, workshop_id, req.manager_salesperson_id,
                                caller.salesperson_id)
            row = await repo.get_workshop(session, workshop_id) or row
        await audit_repo.record(
            session, entity="workshops", entity_id=workshop_id, action="update",
            actor=caller.salesperson_id, payload={"changed": changes},
        )
        await session.commit()
    return row


@router.post("/{workshop_id}/deactivate")
async def deactivate_workshop(workshop_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Retire a workshop. Refused while it still holds unfinished allocated items —
    deactivating it would strand them off the board with nobody responsible."""
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        authz.assert_admin(caller, action="manage workshops")
        if await repo.get_workshop(session, workshop_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workshop not found")
        open_items = await repo.open_item_count(session, workshop_id)
        if open_items:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Workshop has {open_items} item(s) still in production — reallocate them first",
            )
        row = await repo.deactivate_workshop(session, workshop_id)
        await audit_repo.record(
            session, entity="workshops", entity_id=workshop_id, action="deactivate",
            actor=caller.salesperson_id, payload={"name": row["name"] if row else None},
        )
        await session.commit()
    logger.info("Deactivated workshop %s", workshop_id)
    return row


# ════════════════════════════════════════════════════════════════════════════
# Module 14 — the staff roster (lead + sub-managers)
# ════════════════════════════════════════════════════════════════════════════
class StaffRequest(BaseModel):
    salesperson_id: UUID
    role: str = Field(pattern="^(lead|sub)$")


@router.get("/mine")
async def my_workshops(caller_uid: str = Depends(get_caller_uid)) -> dict:
    """The workshops the caller is staff of, with their role at each.

    The workshop PWA's first call: it is what replaced the old
    `manager_salesperson_id = me` filter, which matched nothing for a sub-manager and
    left them staring at an empty queue.
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        if caller.is_admin:
            rows = await repo.list_workshops(session, active_only=True)
            return {"workshops": [{**r, "staff_role": "lead"} for r in rows]}
        workshops = await staff_repo.my_workshops(session, caller.salesperson_id)
    return {"workshops": workshops}


@router.get("/{workshop_id}/staff")
async def list_staff(workshop_id: UUID, active: bool = True,
                     caller_uid: str = Depends(get_caller_uid)) -> dict:
    """The roster. Readable by any active staff member — a name and the word 'lead'
    carry no money, and the courier app shows the destination lead's phone so the
    driver can call ahead."""
    async with make_task_session() as session:
        await authz.resolve_caller(session, caller_uid)
        if await repo.get_workshop(session, workshop_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workshop not found")
        rows = await staff_repo.list_staff(session, workshop_id, active_only=active)
    return {"staff": rows}


@router.post("/{workshop_id}/staff", status_code=status.HTTP_201_CREATED)
async def add_staff(workshop_id: UUID, req: StaffRequest,
                    caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Appoint a lead or a sub-manager.

    Owner/admin only — appointing staff is not self-serve, the same call 0005's
    owner-only `ca_insert` makes for customer assignments. A lead appointment
    automatically retires the incumbent (that is what "promote" means, and doing it in
    two client calls would fail on the one-active-lead index between them).
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        authz.assert_admin(caller, action="manage workshop staff")

        workshop = await repo.get_workshop(session, workshop_id)
        if workshop is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workshop not found")
        if not workshop["active"]:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Cannot staff an inactive workshop")
        await _check_manager(session, req.salesperson_id)

        if req.role == "lead":
            await _appoint_lead(session, workshop_id, req.salesperson_id, caller.salesperson_id)
        else:
            existing = await staff_repo.get_membership(
                session, workshop_id=workshop_id, salesperson_id=req.salesperson_id
            )
            if existing is not None:
                if existing["role"] == "sub":
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="This person is already a sub-manager here",
                    )
                # Demoting the lead: retire the lead row, then add the sub row.
                await staff_repo.deactivate_membership(
                    session, workshop_id=workshop_id, salesperson_id=req.salesperson_id
                )
            await staff_repo.add_staff(
                session, workshop_id=workshop_id, salesperson_id=req.salesperson_id,
                role="sub", actor_id=caller.salesperson_id,
            )

        rows = await staff_repo.list_staff(session, workshop_id)
        await session.commit()
    logger.info("Appointed %s as %s at workshop %s", req.salesperson_id, req.role, workshop_id)
    return {"staff": rows}


@router.post("/{workshop_id}/staff/{salesperson_id}/deactivate")
async def remove_staff(workshop_id: UUID, salesperson_id: UUID,
                       caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Retire a roster row. The person keeps their login and their history; they simply
    stop seeing this workshop's queue.

    Removing the LAST lead while the workshop still holds unfinished work is refused:
    nobody could then receive an incoming consignment there, and the goods would be
    stuck on a lorry with no one authorised to accept them.
    """
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        authz.assert_admin(caller, action="manage workshop staff")

        membership = await staff_repo.get_membership(
            session, workshop_id=workshop_id, salesperson_id=salesperson_id
        )
        if membership is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="This person is not active staff of that workshop")
        if membership["role"] == "lead":
            open_items = await repo.open_item_count(session, workshop_id)
            if open_items:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"This workshop still holds {open_items} item(s) — appoint a new "
                        "lead first, or nobody can receive goods there"
                    ),
                )
        row = await staff_repo.deactivate_membership(
            session, workshop_id=workshop_id, salesperson_id=salesperson_id
        )
        await audit_repo.record(
            session, entity="workshop_staff", entity_id=row["id"] if row else None,
            action="deactivate", actor=caller.salesperson_id,
            payload={"workshop_id": str(workshop_id), "salesperson_id": str(salesperson_id),
                     "role": membership["role"]},
        )
        rows = await staff_repo.list_staff(session, workshop_id)
        await session.commit()
    return {"staff": rows}
