"""POST /api/enrollment — kiosk customer registration (Layer 3).

Auth: API-Key header (same EDGE_API_KEY as /api/recognition).
Writes consent + customer + optionally face_embedding in one transaction.
Returns consent_id + customer_id so the edge worker can link the face to the
correct customer row when it later fires a RecognitionEvent with consent_token.
"""

import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, status

from topaz_shared import EnrollmentRequest

from ..config import get_settings
from ..database import make_task_session
from ..repositories.enrollment_repo import enroll_customer, enroll_face

logger = logging.getLogger(__name__)
router = APIRouter()


def _verify_api_key(provided: str) -> None:
    settings = get_settings()
    expected = settings.EDGE_API_KEY.encode()
    if not hmac.compare_digest(expected, provided.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


@router.post("/enrollment", status_code=status.HTTP_201_CREATED)
async def enroll(
    req: EnrollmentRequest,
    api_key: str = Header(alias="API-Key"),
) -> dict:
    """Create a consent record, customer row, and optionally a face embedding."""
    _verify_api_key(api_key)

    async with make_task_session() as session:
        consent_id, customer_id = await enroll_customer(
            session,
            name=req.name,
            phone=req.phone,
            wa_id=req.wa_id,
            primary_interest=req.primary_interest,
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

        await session.commit()

    logger.info(
        "Enrolled customer=%s consent=%s face=%s",
        customer_id, consent_id, enrolled,
    )
    return {
        "consent_id": str(consent_id),
        "customer_id": str(customer_id),
        "enrolled": enrolled,
    }
