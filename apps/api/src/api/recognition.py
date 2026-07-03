"""POST /api/recognition — edge-worker ingestion endpoint.

Auth: API-Key header compared via hmac.compare_digest (constant-time, §19-G).
On valid payload, enqueues the Celery task and returns 202 Accepted immediately.
Business logic lives entirely in tasks.recognition.process_recognition_event.
"""

import hmac
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, status

from topaz_shared import RecognitionEvent

from ..config import get_settings
from ..tasks.recognition import process_recognition_event

router = APIRouter()


def _verify_api_key(provided: str) -> None:
    settings = get_settings()
    expected = settings.EDGE_API_KEY.encode()
    if not hmac.compare_digest(expected, provided.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


@router.post("/recognition", status_code=status.HTTP_202_ACCEPTED)
async def ingest_recognition_event(
    event: RecognitionEvent,
    api_key: str = Header(alias="API-Key"),
) -> dict:
    _verify_api_key(api_key)

    try:
        process_recognition_event.delay(
            raw_event_id=str(event.raw_event_id),
            embedding=event.embedding,
            quality_score=event.quality_score,
            photo_key=event.photo_key,
            camera_id=event.camera_id,
            captured_at=event.captured_at.isoformat(),
            consent_token=event.consent_token,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Task queue unavailable; retry shortly",
        ) from exc

    return {"raw_event_id": str(event.raw_event_id), "queued": True}
