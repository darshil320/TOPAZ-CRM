"""Media API — signed-upload → complete → thumbnail (Phase 2B, module 08).

Why a two-step upload: the bytes belong in a PRIVATE bucket, and the service-role
key must never reach a browser. So the API mints a short-lived signed upload URL,
the client PUTs the file straight to Storage, then calls back to confirm.

Ordering of the sign-upload checks is deliberate — cheapest and most-specific
first, so the caller always learns the real reason:
  1. entity_type / kind / mime enums          → 422 (pure, services/media_entities)
  2. entity_type='delivery'                    → 422 (reserved for Phase 2C)
  3. entity_type x kind pairing                → 422
  4. the parent row actually exists            → 404 (no FK can enforce this)
  5. caller may write this entity              → 403
  6. DPDPA: customer media needs consent       → 409

`media` has no FK on entity_id (one column, five tables), so step 4 plus the frozen
whitelist in services/media_entities is the entire integrity boundary.
"""

import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..config import get_settings
from ..database import make_task_session
from ..repositories import media_repo as repo
from ..services import media_entities, storage
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/media", dependencies=[Depends(require_dashboard_key)])

# A workshop manager may only attach production evidence, and only to an item their
# own workshop currently holds. Anything else is somebody else's customer.
_WORKSHOP_ENTITY_TYPES = {"order_item", "production_event"}
_WORKSHOP_KINDS = {"production", "finished"}


class SignUploadRequest(BaseModel):
    entity_type: str
    entity_id: UUID
    kind: str
    mime: str


class CompleteRequest(BaseModel):
    bytes: int = Field(gt=0)


async def _authorize_upload(session, caller: authz.Caller, entity_type: str, entity_id: UUID) -> None:
    """Who may attach media to this entity."""
    # A CATALOG photo belongs to no customer — it is reused across every future
    # quote and order line for that product, so a bad one is a company-wide defect,
    # not one customer's problem. Gate it on the same owner/admin role that already
    # governs the products table (products_insert/products_update RLS, 0013).
    if entity_type == "product":
        authz.assert_admin(caller, action="upload catalog photos")
        return

    if caller.role == "workshop_manager":
        workshop_id = await repo.workshop_id_for_entity(session, entity_type, entity_id)
        if workshop_id is None or not await _manages(session, caller, workshop_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Not authorized to add photos to this item")
        return
    customer_id = await repo.customer_id_for_entity(session, entity_type, entity_id)
    if customer_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    await authz.assert_can_write_customer(session, caller, customer_id)


async def _manages(session, caller: authz.Caller, workshop_id: str) -> bool:
    from sqlalchemy import text

    result = await session.execute(
        text(
            "SELECT 1 FROM workshops WHERE id = :wid AND active = true"
            "   AND manager_salesperson_id = :sp"
        ),
        {"wid": workshop_id, "sp": caller.salesperson_id},
    )
    return result.first() is not None


@router.post("/sign-upload", status_code=status.HTTP_201_CREATED)
async def sign_upload(req: SignUploadRequest, caller_uid: str = Depends(get_caller_uid)) -> dict:
    settings = get_settings()
    try:
        media_entities.validate_request(req.entity_type, req.kind, req.mime)
    except media_entities.MediaRuleError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=str(exc)) from exc
    table = media_entities.table_for(req.entity_type)
    if table is None:                       # unreachable after validate_request; defensive
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"Cannot store media for '{req.entity_type}'")

    media_id = uuid4()
    storage_key = media_entities.build_key(req.entity_type, req.entity_id, media_id, req.mime)

    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        if caller.role in ("accounts", "delivery"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Your role cannot upload photos")
        if not await repo.entity_exists(session, table, req.entity_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"No {req.entity_type} with that id")
        await _authorize_upload(session, caller, req.entity_type, req.entity_id)

        # DPDPA (0025 header): a photo filed against a customer is personal data.
        if media_entities.requires_consent(req.entity_type):
            if not await repo.has_active_personal_data_consent(session, str(req.entity_id)):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Customer has not consented to storing personal data — capture consent first",
                )

        # Sign BEFORE committing the row: if Storage is down we must not leave a
        # pending row that can never be completed.
        try:
            upload_url = storage.signed_upload_url(
                settings.MEDIA_BUCKET, storage_key, settings.MEDIA_UPLOAD_TTL_SECONDS
            )
        except storage.StorageError as exc:
            logger.error("Sign upload failed for %s: %s", storage_key, exc)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                                detail="Could not prepare the upload — try again") from exc

        row = await repo.create_pending(
            session, media_id=media_id, entity_type=req.entity_type, entity_id=req.entity_id,
            kind=req.kind, storage_key=storage_key, mime=req.mime,
            created_by=UUID(caller.salesperson_id),
        )
        await session.commit()

    logger.info("Signed media upload %s for %s %s", media_id, req.entity_type, req.entity_id)
    return {
        "media_id": str(row["id"]),
        "storage_key": storage_key,
        "upload_url": upload_url,
        "expires_in": settings.MEDIA_UPLOAD_TTL_SECONDS,
        "max_bytes": settings.MEDIA_MAX_BYTES,
    }


@router.post("/{media_id}/complete")
async def complete_upload(media_id: UUID, req: CompleteRequest,
                          caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Confirm the bytes landed, then enqueue the thumbnail.

    IDEMPOTENT: calling this on an already-ready row returns 200 with the same body.
    A workshop manager on a flaky phone network WILL retry this call, and an error
    for having succeeded twice is a support ticket, not a safety feature.
    """
    settings = get_settings()
    # Cheap pre-check on the client's claim. It is NOT the enforcement point —
    # the browser PUTs straight to a signed URL, so `req.bytes` is only a claim.
    # The real size comes from Storage below.
    if req.bytes > settings.MEDIA_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Image too large ({req.bytes} bytes, max {settings.MEDIA_MAX_BYTES})",
        )

    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        row = await repo.get_media(session, media_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")
        if str(row["created_by"]) != caller.salesperson_id and not caller.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Not your upload")
        if row["status"] == "failed":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Upload failed — request a new upload URL")
        if row["status"] == "ready":
            return {"id": str(media_id), "status": "ready", "thumb_pending": row["thumb_key"] is None}

        # Ask STORAGE how big it really is. Two jobs at once: a client that never
        # finished its PUT must not leave a 'ready' row (a broken tile forever), and
        # the size ceiling must be enforced against the object rather than against
        # the client's self-reported number — otherwise a caller PUTs 500 MB and
        # reports `{"bytes": 1}`.
        try:
            actual_bytes = storage.object_size(settings.MEDIA_BUCKET, row["storage_key"])
        except storage.StorageError as exc:
            logger.error("Storage stat failed for %s: %s", row["storage_key"], exc)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                                detail="Could not verify the upload — try again") from exc
        if actual_bytes is None:
            await repo.mark_failed(session, media_id)
            await session.commit()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="No file was received — request a new upload URL")
        if actual_bytes > settings.MEDIA_MAX_BYTES:
            # Mark it failed so the oversized object is a GC target rather than a
            # live row the gallery would try to render.
            await repo.mark_failed(session, media_id)
            await session.commit()
            logger.warning("Oversized upload %s: %d bytes (claimed %d, max %d)",
                           media_id, actual_bytes, req.bytes, settings.MEDIA_MAX_BYTES)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Image too large ({actual_bytes} bytes, max {settings.MEDIA_MAX_BYTES})",
            )

        # Persist the VERIFIED size, never the claimed one.
        await repo.mark_ready(session, media_id, size_bytes=actual_bytes)
        await session.commit()

    # Thumbnails are best-effort: the row is committed, and the gallery falls back to
    # the full image when thumb_key stays NULL. A broker hiccup must not 500 an
    # upload the manager already completed.
    try:
        from ..tasks.media import make_thumb

        make_thumb.delay(str(media_id))
    except Exception:
        logger.warning("Thumbnail enqueue failed for media %s — full image still usable",
                       media_id, exc_info=True)
    return {"id": str(media_id), "status": "ready", "thumb_pending": True}


@router.get("/{media_id}/url")
async def media_url(media_id: UUID, thumb: bool = False,
                    caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Short-lived signed READ url. `thumb=true` falls back to the full image when
    the thumbnail hasn't been generated (or failed)."""
    settings = get_settings()
    async with make_task_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        row = await repo.get_media(session, media_id)
        if row is None or row["status"] != "ready":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not available")
        # Mirrors the media_select RLS policy: customer media is off-limits to the
        # production/delivery roles.
        if row["entity_type"] == "customer" and caller.role in ("workshop_manager", "delivery"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Not authorized to view this image")
    key = row["thumb_key"] if (thumb and row["thumb_key"]) else row["storage_key"]
    try:
        url = storage.signed_url(settings.MEDIA_BUCKET, key, settings.MEDIA_URL_TTL_SECONDS)
    except storage.StorageError as exc:
        logger.error("Media URL sign failed for %s: %s", media_id, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not generate the image link") from exc
    return {"url": url, "is_thumb": key != row["storage_key"]}
