"""Front desk API (0052) — assign a walk-in to a salesperson.

    POST /api/frontdesk/walkins/{customer_id}/assign   {salesperson_id}
         200 {customer_id, assigned_to: {id, name}}
         404 unknown customer
         409 already claimed, or the customer withdrew consent
         422 not an active salesperson

Used from the kiosk (a front desk manager registering someone picks the salesperson at
sign-up) and from the front desk board (any unclaimed walk-in). Assigning makes that
salesperson the primary, so the walk-in leaves everyone's queue. Walk-ins nobody
assigns stay in every salesperson's queue, as before — this route changes nothing else.

The API runs on the service-role connection, so authz.assert_dispatcher is the gate.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..database import get_api_session
from ..repositories import assignment_repo, walkin_repo
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/frontdesk", dependencies=[Depends(require_dashboard_key)])


class AssignRequest(BaseModel):
    salesperson_id: UUID


async def _assignable_or_raise(session, customer_id: UUID) -> None:
    state = await walkin_repo.get_walkin_state(session, customer_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    if state["consent_withdrawn"]:
        # DPDPA: they re-register themselves; staff cannot hand them out again.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="This customer withdrew their consent")
    if state["primary_name"]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Already claimed by {state['primary_name']}")


@router.post("/walkins/{customer_id}/assign")
async def assign_walkin(customer_id: UUID, req: AssignRequest,
                        auth_uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, auth_uid)
        authz.assert_dispatcher(caller, action="assign a walk-in")
        target = await assignment_repo.get_selling_staff(session, req.salesperson_id)
        if target is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="Choose an active salesperson")
        await _assignable_or_raise(session, customer_id)
        assigned = await walkin_repo.assign_primary(
            session, customer_id=customer_id, salesperson_id=req.salesperson_id,
            assigned_by=UUID(caller.salesperson_id),
        )
        if not assigned:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="A salesperson claimed this walk-in a moment ago")
        await session.commit()
    logger.info("Walk-in %s assigned to %s by %s", customer_id, req.salesperson_id,
                caller.salesperson_id)
    return {"customer_id": str(customer_id),
            "assigned_to": {"id": str(req.salesperson_id), "name": target["name"]}}
