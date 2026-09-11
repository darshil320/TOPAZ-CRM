"""Lead call-recording API — signed-upload -> complete -> list, scoped to one lead.

Same two-step signed-upload shape as api/media.py (the service-role key must never
reach a browser), but deliberately its own router rather than folded into
api/media.py or api/leads.py: this is a single-entity concern (only ever a `lead`),
with its own table (`lead_recordings`, 0048) and bucket (`lead-audio`) — see 0048's
header for why this is not `media`.

GATING, restated from the plan:
  * sign-upload / complete  -> authz.assert_can_edit_lead (creator + owner only,
    same rule LeadEditForm's PATCH already enforces — a voice note is exactly the
    kind of lead detail that gate protects).
  * list                    -> open to any active salesperson, matching leads_select
    ("the person who picks up the phone is rarely the one who took the original
    enquiry" applies identically to hearing a prior call).
No DELETE route: mirrors 0046's "no delete policy ever" — a recording is evidence
of what was actually said on a call.
"""

import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..config import get_settings
from ..database import get_api_session
from ..repositories import lead_recording_repo as repo
from ..repositories import lead_repo
from ..services import lead_audio, storage
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/leads", dependencies=[Depends(require_dashboard_key)])


class SignUploadRequest(BaseModel):
    mime: str
    note: str | None = Field(default=None, max_length=500)


class CompleteRequest(BaseModel):
    bytes: int = Field(gt=0)


async def _load_lead_or_404(session, lead_id: UUID) -> dict:
    lead = await lead_repo.get_lead(session, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="lead not found")
    return lead


@router.post("/{lead_id}/recordings/sign-upload", status_code=status.HTTP_201_CREATED)
async def sign_upload(
    lead_id: UUID, req: SignUploadRequest, auth_uid: str = Depends(get_caller_uid)
) -> dict:
    settings = get_settings()
    try:
        lead_audio.validate_mime(req.mime)
    except lead_audio.LeadAudioRuleError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=str(exc)) from exc

    recording_id = uuid4()
    storage_key = lead_audio.build_key(lead_id, recording_id, req.mime)

    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, auth_uid)
        lead = await _load_lead_or_404(session, lead_id)
        authz.assert_can_edit_lead(caller, lead, action="add a recording to this lead")

        # Sign BEFORE inserting the row: if Storage is down we must not leave a
        # pending row that can never be completed (mirrors media.py::sign_upload).
        try:
            upload_url = await storage.signed_upload_url_async(
                settings.LEAD_AUDIO_BUCKET, storage_key, settings.MEDIA_UPLOAD_TTL_SECONDS
            )
        except storage.StorageError as exc:
            logger.error("Sign lead audio upload failed for %s: %s", storage_key, exc)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                                detail="Could not prepare the upload — try again") from exc

        row = await repo.create_pending(
            session, recording_id=recording_id, lead_id=lead_id, storage_key=storage_key,
            mime=req.mime, created_by=UUID(caller.salesperson_id), note=req.note,
        )
        await session.commit()

    logger.info("Signed lead audio upload %s for lead %s", recording_id, lead_id)
    return {
        "recording_id": str(row["id"]),
        "storage_key": storage_key,
        "upload_url": upload_url,
        "expires_in": settings.MEDIA_UPLOAD_TTL_SECONDS,
        "max_bytes": settings.LEAD_AUDIO_MAX_BYTES,
    }


@router.post("/{lead_id}/recordings/{recording_id}/complete")
async def complete_upload(
    lead_id: UUID, recording_id: UUID, req: CompleteRequest,
    auth_uid: str = Depends(get_caller_uid),
) -> dict:
    """Confirm the bytes landed. IDEMPOTENT — same reasoning as media.py's own
    complete route: a salesperson on a flaky connection will retry this call."""
    settings = get_settings()
    if req.bytes > settings.LEAD_AUDIO_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Recording too large ({req.bytes} bytes, max {settings.LEAD_AUDIO_MAX_BYTES})",
        )

    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, auth_uid)
        lead = await _load_lead_or_404(session, lead_id)
        # Re-checked, not just "uploader may complete": a completion confirmation is
        # still a write to this lead's records (mirrors media.py's own-upload check,
        # but using the same creator+owner rule as the rest of this lead's edits).
        authz.assert_can_edit_lead(caller, lead, action="add a recording to this lead")

        row = await repo.get_recording(session, recording_id)
        if row is None or row["lead_id"] != str(lead_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="recording not found")
        if row["status"] == "failed":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Upload failed — request a new upload URL")
        if row["status"] == "ready":
            return {"id": str(recording_id), "status": "ready"}

        try:
            actual_bytes = await storage.object_size_async(
                settings.LEAD_AUDIO_BUCKET, row["storage_key"]
            )
        except storage.StorageError as exc:
            logger.error("Storage stat failed for %s: %s", row["storage_key"], exc)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                                detail="Could not verify the upload — try again") from exc
        if actual_bytes is None:
            await repo.mark_failed(session, recording_id)
            await session.commit()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="No file was received — request a new upload URL")
        if actual_bytes > settings.LEAD_AUDIO_MAX_BYTES:
            await repo.mark_failed(session, recording_id)
            await session.commit()
            logger.warning("Oversized lead recording %s: %d bytes (max %d)",
                           recording_id, actual_bytes, settings.LEAD_AUDIO_MAX_BYTES)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Recording too large ({actual_bytes} bytes, max {settings.LEAD_AUDIO_MAX_BYTES})",
            )

        await repo.mark_ready(session, recording_id, size_bytes=actual_bytes)
        await session.commit()

    return {"id": str(recording_id), "status": "ready"}


@router.get("/{lead_id}/recordings")
async def list_recordings(lead_id: UUID, auth_uid: str = Depends(get_caller_uid)) -> dict:
    """Not creator/owner gated — matches leads_select's open read. Any active
    salesperson may hear a prior call on a lead, same as they may read its fields."""
    settings = get_settings()
    async with get_api_session() as session:
        await authz.resolve_caller(session, auth_uid)
        await _load_lead_or_404(session, lead_id)
        rows = await repo.list_for_lead(session, lead_id)

    if not rows:
        return {"recordings": []}

    keys = [r["storage_key"] for r in rows]
    try:
        signed = await storage.signed_urls_async(
            settings.LEAD_AUDIO_BUCKET, keys, settings.MEDIA_URL_TTL_SECONDS
        )
    except storage.StorageError as exc:
        logger.error("Batch lead-audio URL sign failed for %d recording(s): %s", len(keys), exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not generate the recording links") from exc

    recordings = [
        {
            "id": str(r["id"]), "note": r["note"], "duration_seconds": r["duration_seconds"],
            "bytes": r["bytes"], "created_at": r["created_at"], "created_by": r["created_by"],
            "uploaded_by_name": r["uploaded_by_name"], "url": signed[r["storage_key"]],
        }
        for r in rows if r["storage_key"] in signed
    ]
    return {"recordings": recordings}
