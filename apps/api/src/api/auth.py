"""Auth linking endpoint (Layer 3).

POST /api/auth/link-salesperson — called by the dashboard right after a
salesperson's first successful phone-OTP login. Matches the newly created
Supabase auth user to a pre-seeded `salespersons` row by WhatsApp number and
sets auth_uid, so the owner never has to hand-write auth_uid via SQL (§19-B).
Only links a row with no auth_uid yet (or already linked to this same user) —
never reassigns an existing account. No match is not an error: the caller
falls back to the manual Supabase-Studio instructions.

Auth: API-Key header (DASHBOARD_API_KEY) — dashboard-only, never called by edge.
"""

import logging

from fastapi import APIRouter, Header, status

from topaz_shared import LinkSalespersonRequest

from ..config import get_settings
from ..database import make_task_session
from ..repositories.salesperson_repo import link_salesperson_by_phone
from .enrollment import verify_api_key

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/auth/link-salesperson", status_code=status.HTTP_200_OK)
async def link_salesperson(
    req: LinkSalespersonRequest,
    api_key: str = Header(alias="API-Key"),
) -> dict:
    settings = get_settings()
    verify_api_key(api_key, (settings.DASHBOARD_API_KEY,))

    async with make_task_session() as session:
        salesperson_id = await link_salesperson_by_phone(
            session, auth_uid=req.auth_uid, phone=req.phone
        )
        await session.commit()

    logger.info(
        "Salesperson auto-link attempt auth_uid=%s linked=%s",
        req.auth_uid, salesperson_id is not None,
    )
    return {
        "linked": salesperson_id is not None,
        "salesperson_id": str(salesperson_id) if salesperson_id else None,
    }
