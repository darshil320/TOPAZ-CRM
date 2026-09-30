"""In-app follow-up notification API — list / clear / clear-all.

Not a WhatsApp send (explicit user ask): these are rows a salesperson sees in
the dashboard's notification bell, created by the daily beat scan
(tasks/lead_followup_notify.py) and cleared only by an explicit user action —
never auto-expired (0050's own header).

Scope, restated from the plan: "my leads" — a salesperson sees/clears only
notifications created for them (salesperson_id, fixed at creation time); the
owner sees/clears all. Reads need no ownership assertion (the query itself is
the scope); clears do, via authz.assert_can_clear_notification.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from ..database import get_api_session
from ..repositories import lead_followup_repo as repo
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/leads/notifications", dependencies=[Depends(require_dashboard_key)])


def _scope(caller: authz.Caller) -> str | None:
    """None means owner — every notification, no salesperson filter."""
    return None if caller.role == "owner" else caller.salesperson_id


@router.get("")
async def list_notifications(auth_uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, auth_uid)
        scope = _scope(caller)
        notifications = await repo.list_notifications(session, salesperson_id=scope)
        count = await repo.unread_count(session, salesperson_id=scope)
    return {"notifications": notifications, "unread_count": count}


@router.post("/{notification_id}/clear")
async def clear_notification(notification_id: UUID, auth_uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, auth_uid)
        notification = await repo.get_notification(session, notification_id)
        if notification is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="notification not found")
        authz.assert_can_clear_notification(caller, notification)
        cleared = await repo.clear_notification(session, notification_id)
        await session.commit()
    # cleared is None only on a race (already cleared between the load above and
    # this UPDATE) — return the already-cleared row rather than erroring, same
    # idempotent-retry reasoning media.py's complete route uses.
    return cleared or notification


@router.post("/clear-all")
async def clear_all(auth_uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, auth_uid)
        cleared = await repo.clear_all(session, salesperson_id=_scope(caller))
        await session.commit()
    return {"cleared": cleared}
