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
from ..database import get_api_session
from ..repositories import media_repo as repo
from ..services import media_entities, storage
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/media", dependencies=[Depends(require_dashboard_key)])

# A workshop manager may only attach production evidence, and only to an item their
# own workshop currently holds. Anything else is somebody else's customer.
# Module 14 adds the handover frame: a consignment photo, filed against the run.
_WORKSHOP_ENTITY_TYPES = {"order_item", "production_event", "workshop_transfer"}
_WORKSHOP_KINDS = {"production", "finished", "transit"}

# A courier's ONE upload path. `delivery` is otherwise barred from this endpoint (it
# mints billable Storage credentials), but the two-party handover is built on that
# person photographing the goods at both ends, so the exception is the feature.
_COURIER_ENTITY_TYPES = {"workshop_transfer"}
_COURIER_KINDS = {"transit"}


class SignUploadRequest(BaseModel):
    entity_type: str
    entity_id: UUID
    kind: str
    mime: str
    # ACCEPTED AND IGNORED for production media. The field exists so an older client
    # that sends it is not a 422, and so the intent is visible in the API contract — but
    # the stage a photo belongs to is resolved from the item's own `current_stage`
    # server-side (0036). A phone left open on a stale screen must not be able to file
    # evidence under the wrong stage.
    stage_code: str | None = None


class CompleteRequest(BaseModel):
    bytes: int = Field(gt=0)


class UrlsRequest(BaseModel):
    """Batch signed-read request. The ceiling is a real bound, not a guess: the
    largest caller is an order's photo gallery, and signing is billable work on
    Supabase's side — an unbounded list would let one call fan out arbitrarily."""

    media_ids: list[UUID] = Field(min_length=1, max_length=100)
    thumb: bool = True


async def _authorize_upload(session, caller: authz.Caller, entity_type: str, entity_id: UUID) -> None:
    """Who may attach media to this entity."""
    # A CATALOG photo belongs to no customer — it is reused across every future
    # quote and order line for that product, so a bad one is a company-wide defect,
    # not one customer's problem. Gate it on the same owner/admin role that already
    # governs the products table (products_insert/products_update RLS, 0013).
    if entity_type == "product":
        authz.assert_admin(caller, action="upload catalog photos")
        return

    # A HANDOVER photo (module 14, 0031) belongs to a consignment, not a customer: it
    # is filed by whoever is physically holding the goods. That is the assigned courier
    # — a `delivery` user who has no customer relationship at all and would fail every
    # other branch here — or staff of either end of the run.
    if entity_type == "workshop_transfer":
        await _authorize_transfer_upload(session, caller, entity_id)
        return

    # ROSTER FIRST, role second. A production photo belongs to whoever is holding the
    # goods, and 0029 says the roster decides that — not the coarse `salespersons.role`.
    # Testing the role first meant a sub-manager still carrying role='salesperson' was
    # sent down the customer-ownership path and 403'd out of the four photo_required
    # stages she is employed to complete (same defect as authz._NO_ROSTER_ROLES).
    if entity_type in _WORKSHOP_ENTITY_TYPES:
        workshop_id = await repo.workshop_id_for_entity(session, entity_type, entity_id)
        if workshop_id is not None and await _is_staff_of(session, caller, workshop_id):
            return
        if caller.role == "workshop_manager":
            # No roster row anywhere near this item: there is no customer relationship
            # to fall back on for a workshop user, so this is the end of the line.
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Not authorized to add photos to this item")
        # Anyone else falls through to the customer-ownership check below — an assigned
        # salesperson may still photograph their own customer's item.
    customer_id = await repo.customer_id_for_entity(session, entity_type, entity_id)
    if customer_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    await authz.assert_can_write_customer(session, caller, customer_id)


async def _is_staff_of(session, caller: authz.Caller, workshop_id: str) -> bool:
    """Active roster membership at this workshop, ANY role.

    Module 14 changed this from a `workshops.manager_salesperson_id = me` test. It had
    to: four production stages are photo_required (0024), so a sub-manager who could
    not upload could not complete a stage at all — the hierarchy would have shipped
    with its main user unable to do the one thing it exists to let them do.
    """
    from ..repositories import workshop_staff_repo

    role = await workshop_staff_repo.staff_role_at(
        session, salesperson_id=caller.salesperson_id, workshop_id=workshop_id
    )
    return role is not None


async def _authorize_transfer_upload(session, caller: authz.Caller, transfer_id: UUID) -> None:
    from sqlalchemy import text

    if caller.is_admin:
        return
    result = await session.execute(
        text(
            "SELECT from_workshop_id, to_workshop_id, courier_salesperson_id, status"
            " FROM workshop_transfers WHERE id = :id"
        ),
        {"id": str(transfer_id)},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consignment not found")
    if row["status"] in ("received", "cancelled"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This consignment is closed — its handover photos are final",
        )
    if caller.role == "delivery":
        assigned = row["courier_salesperson_id"]
        if assigned is None or str(assigned) == caller.salesperson_id:
            return
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="This consignment is assigned to another courier")
    for side in ("from_workshop_id", "to_workshop_id"):
        if await _is_staff_of(session, caller, str(row[side])):
            return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to add photos to this consignment")


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

    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        if caller.role == "accounts":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Your role cannot upload photos")
        if caller.role == "delivery" and not (
            req.entity_type in _COURIER_ENTITY_TYPES and req.kind in _COURIER_KINDS
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="A courier may only upload handover photos for a consignment",
            )
        if caller.role == "workshop_manager" and not (
            req.entity_type in _WORKSHOP_ENTITY_TYPES and req.kind in _WORKSHOP_KINDS
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "A workshop may only upload production, finished or handover photos"
                ),
            )
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
            upload_url = await storage.signed_upload_url_async(
                settings.MEDIA_BUCKET, storage_key, settings.MEDIA_UPLOAD_TTL_SECONDS
            )
        except storage.StorageError as exc:
            logger.error("Sign upload failed for %s: %s", storage_key, exc)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                                detail="Could not prepare the upload — try again") from exc

        # Which stage does this photo document? A server fact, not a client claim
        # (0036). Resolved after the existence check, so a missing item 404s first.
        stage_code = await repo.stage_code_for_entity(
            session, req.entity_type, req.entity_id
        )
        if req.stage_code and req.stage_code != stage_code:
            logger.info(
                "Ignoring client stage_code '%s' for %s %s — server says '%s'",
                req.stage_code, req.entity_type, req.entity_id, stage_code,
            )

        row = await repo.create_pending(
            session, media_id=media_id, entity_type=req.entity_type, entity_id=req.entity_id,
            kind=req.kind, storage_key=storage_key, mime=req.mime,
            created_by=UUID(caller.salesperson_id), stage_code=stage_code,
        )
        await session.commit()

    logger.info("Signed media upload %s for %s %s (stage %s)",
                media_id, req.entity_type, req.entity_id, stage_code or "-")
    return {
        "media_id": str(row["id"]),
        "storage_key": storage_key,
        "upload_url": upload_url,
        "expires_in": settings.MEDIA_UPLOAD_TTL_SECONDS,
        "max_bytes": settings.MEDIA_MAX_BYTES,
        "stage_code": stage_code,
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

    async with get_api_session() as session:
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
            actual_bytes = await storage.object_size_async(
                settings.MEDIA_BUCKET, row["storage_key"]
            )
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
    async with get_api_session() as session:
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
        url = await storage.signed_url_async(
            settings.MEDIA_BUCKET, key, settings.MEDIA_URL_TTL_SECONDS
        )
    except storage.StorageError as exc:
        logger.error("Media URL sign failed for %s: %s", media_id, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not generate the image link") from exc
    return {"url": url, "is_thumb": key != row["storage_key"]}


@router.post("/urls")
async def media_urls(req: UrlsRequest, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Signed READ urls for MANY images in ONE call.

    WHY THIS EXISTS (perf, not convenience): `/{media_id}/url` costs a caller
    verification, a DB round-trip and an HTTPS sign per image. A line-item table or
    a production gallery asked for twenty of them, and Next.js serialises Server
    Actions — so the dashboard paid twenty sequential round-trips and filled the
    table in visibly. This route does the same work as one caller lookup, one
    `id = ANY(...)` query and one batched Storage sign.

    PARTIAL SUCCESS IS THE CONTRACT, deliberately: an id that is missing, not
    `ready`, not visible to this role, or whose object failed to sign is absent
    from `urls`. The caller renders its placeholder for that tile. One dead storage
    key must not blank out a whole gallery — and a 404 for the batch would.
    """
    settings = get_settings()
    ids = list(dict.fromkeys(req.media_ids))
    if not ids:
        return {"urls": {}}

    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        rows = await repo.get_media_many(session, ids)

    # Same rule as media_url above (and the media_select RLS policy): customer
    # media is off-limits to the production/delivery roles.
    hides_customer_media = caller.role in ("workshop_manager", "delivery")
    keyed: dict[str, dict] = {}
    for row in rows:
        if row["status"] != "ready":
            continue
        if row["entity_type"] == "customer" and hides_customer_media:
            continue
        keyed[str(row["id"])] = row

    if not keyed:
        return {"urls": {}}

    # Decide the object per media row BEFORE signing, so the batch signs each
    # distinct storage key exactly once.
    wanted = {
        media_id: (row["thumb_key"] if (req.thumb and row["thumb_key"]) else row["storage_key"])
        for media_id, row in keyed.items()
    }
    try:
        signed = await storage.signed_urls_async(
            settings.MEDIA_BUCKET, list(wanted.values()), settings.MEDIA_URL_TTL_SECONDS
        )
    except storage.StorageError as exc:
        # The whole request failed (Storage unreachable/unconfigured), not one key.
        logger.error("Batch media URL sign failed for %d image(s): %s", len(wanted), exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not generate the image links") from exc

    urls = {
        media_id: {"url": signed[key], "is_thumb": key != keyed[media_id]["storage_key"]}
        for media_id, key in wanted.items()
        if key in signed
    }
    if len(urls) < len(wanted):
        logger.warning("Batch media URL signed %d of %d requested image(s)", len(urls), len(wanted))
    return {"urls": urls}
