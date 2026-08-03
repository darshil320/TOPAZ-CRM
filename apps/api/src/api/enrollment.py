"""Kiosk enrollment endpoints (Layer 3).

POST /api/enrollment          — kiosk customer registration.
GET  /api/enrollment/pending  — edge worker polls for a claimable consent token
                                (§19-E seam: token = consent UUID of the most
                                recent kiosk enrollment still awaiting a face).

Auth: API-Key header. POST is called by the dashboard kiosk (DASHBOARD_API_KEY)
and may also carry a face embedding from the edge worker (EDGE_API_KEY), so it
accepts either. GET /pending is edge-only (EDGE_API_KEY).
POST writes consent + customer + optionally face_embedding in one transaction,
and queues the welcome followup when the customer opted into WhatsApp.
"""

import hmac
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException, status

from topaz_shared import EnrollmentRequest

from ..config import get_settings
from ..database import make_task_session
from ..repositories.enrollment_repo import (
    enroll_customer,
    enroll_face,
    find_pending_consent_token,
)
from ..repositories.followup_repo import schedule_followup
from ..repositories.salesperson_repo import list_active_notifiable

logger = logging.getLogger(__name__)
router = APIRouter()

WELCOME_TEMPLATE = "welcome_visit"


def verify_api_key(provided: str, accepted: tuple[str | None, ...]) -> None:
    """Raise 401 unless `provided` matches one of the configured keys.

    Unset keys (None/empty) never match, so a missing DASHBOARD_API_KEY
    cannot be satisfied by an empty header.
    """
    for key in accepted:
        if key and hmac.compare_digest(key.encode(), provided.encode()):
            return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


@router.post("/enrollment", status_code=status.HTTP_201_CREATED)
async def enroll(
    req: EnrollmentRequest,
    api_key: str = Header(alias="API-Key"),
) -> dict:
    """Create a consent record, customer row, and optionally a face embedding."""
    settings = get_settings()
    verify_api_key(api_key, (settings.DASHBOARD_API_KEY, settings.EDGE_API_KEY))

    async with make_task_session() as session:
        consent_id, customer_id = await enroll_customer(
            session,
            name=req.name,
            phone=req.phone,
            wa_id=req.wa_id,
            primary_interest=req.primary_interest,
            interest_summary=req.interest_summary,
            face_tracking=req.face_tracking,
            personal_data=req.personal_data,
            whatsapp_marketing=req.whatsapp_marketing,
        )

        enrolled = False
        if req.face_tracking and req.face_embedding:
            await enroll_face(
                session,
                customer_id=customer_id,
                embedding=req.face_embedding,
                quality_score=req.quality_score,
                camera_id=req.camera_id,
            )
            enrolled = True

        followup_id = None
        if req.wa_id and req.whatsapp_marketing:
            followup_id = await schedule_followup(
                session,
                customer_id=customer_id,
                template_name=WELCOME_TEMPLATE,
                template_vars={"name": req.name or ""},
                scheduled_at=datetime.now(timezone.utc)
                + timedelta(minutes=settings.WELCOME_FOLLOWUP_DELAY_MINUTES),
            )

        # Every kiosk enrollment IS a new customer row (enroll_customer never
        # updates an existing one) — so this fires exactly once per real
        # registration, no NEW-vs-REPEAT check needed the way the camera
        # pipeline (tasks/recognition.py) requires for its own alert.
        staff = await list_active_notifiable(session)

        await session.commit()

    # Fired AFTER commit, one Celery task per recipient (matches
    # send_salesperson_alert's own dispatch shape) — a slow/failed send to one
    # staff member's phone must never block or duplicate another's, and the
    # enrollment itself must not roll back over a notification problem.
    from ..tasks.whatsapp import send_new_registration_alert

    for person in staff:
        send_new_registration_alert.delay(
            person["whatsapp"], req.name, req.primary_interest,
        )

    logger.info(
        "Enrolled customer=%s consent=%s face=%s welcome_followup=%s notified=%d staff",
        customer_id, consent_id, enrolled, followup_id, len(staff),
    )
    return {
        "consent_id": str(consent_id),
        "customer_id": str(customer_id),
        "enrolled": enrolled,
    }


@router.get("/enrollment/pending")
async def pending_consent(
    api_key: str = Header(alias="API-Key"),
) -> dict:
    """Return the consent token the entrance camera should attach, if any.

    The edge worker polls this endpoint; a non-null token means "a customer
    just registered at the kiosk and their face has not been captured yet".
    """
    settings = get_settings()
    verify_api_key(api_key, (settings.EDGE_API_KEY,))

    async with make_task_session() as session:
        token = await find_pending_consent_token(
            session, settings.ENROLLMENT_PENDING_WINDOW_SECONDS
        )

    return {"consent_token": str(token) if token else None}
