"""Workshops API — admin CRUD + a list with per-workshop load hints (Phase 2B, 08).

Writes go through here rather than straight to Supabase (even though RLS would
allow the admin tab to write directly) because two rules cannot live in RLS: the
E.164 phone validation with a usable message, and the deactivation guard that
refuses to retire a workshop still holding live work.

Reads: the dashboard may query `workshops` directly under RLS; GET here exists for
the allocate modal, which also needs the open-item count.

There is NO delete endpoint, by design — workshops are deactivated (0023).
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from ..database import make_task_session
from ..repositories import audit_repo
from ..repositories import workshop_repo as repo
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
                manager_salesperson_id=req.manager_salesperson_id, address=req.address,
            )
        except IntegrityError as exc:
            raise _duplicate_name(exc, req.name) from exc
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
        if "manager_salesperson_id" in changes:
            await _check_manager(session, req.manager_salesperson_id)
        if "name" in changes and changes["name"]:
            changes["name"] = changes["name"].strip()
        try:
            row = await repo.update_workshop(session, workshop_id, changes)
        except IntegrityError as exc:
            raise _duplicate_name(exc, changes.get("name")) from exc
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workshop not found")
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
