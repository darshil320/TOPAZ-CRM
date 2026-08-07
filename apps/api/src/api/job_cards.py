"""Job card API — render and send the spec sheet (Phase 2B addition).

A job card is the visual companion to a quotation and the workshop's production
sheet. It carries NO money (see migration 0027 + services/job_card_html), so the
identical PDF is safe for both the customer and an outside vendor workshop.

Contract:
    POST /api/job-cards/{source}/{entity_id}          source = quotation | order
      200 {status:'queued', source, entity_id}        render + file the PDF
    POST /api/job-cards/{source}/{entity_id}/send     {to: 'customer'|'workshop'}
      200 {status:'queued', to}                       render if needed, then send
    GET  /api/job-cards/{source}/{entity_id}/url
      200 {url}                                       signed link to the latest PDF
      404 not rendered yet

Rendering is a Celery job (Playwright is slow and must not block a request), so
these return `queued`, matching how quotation PDFs already work.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..config import get_settings
from ..database import get_api_session
from ..repositories import audit_repo, document_repo, job_card_repo, order_repo, quotation_repo
from ..services import storage
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/job-cards", dependencies=[Depends(require_dashboard_key)])

_SOURCES = ("quotation", "order")


class SendRequest(BaseModel):
    to: str = Field(pattern="^(customer|workshop)$")


def _check_source(source: str) -> None:
    if source not in _SOURCES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"source must be one of {', '.join(_SOURCES)}")


async def _authorize(session, caller_uid: str, source: str, entity_id: UUID):
    """Resolve the caller and assert write access to the underlying customer.
    404 if the parent record does not exist. Returns (Caller, customer_id)."""
    caller = await authz.resolve_caller(session, caller_uid)
    if source == "quotation":
        customer_id = await quotation_repo.quotation_customer_id(session, entity_id)
    else:
        customer_id = await order_repo.order_customer_id(session, entity_id)
    if customer_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"{source.capitalize()} not found")
    await authz.assert_can_write_customer(session, caller, str(customer_id))
    return caller, str(customer_id)


@router.post("/{source}/{entity_id}")
async def create_job_card(source: str, entity_id: UUID,
                          caller_uid: str = Depends(get_caller_uid)) -> dict:
    _check_source(source)
    async with get_api_session() as session:
        await _authorize(session, caller_uid, source, entity_id)
        # Cheap count, not a full job-card load: the previous version resolved every
        # photo key here only to test emptiness, then the Celery task threw it away
        # and refetched. Purely defensive now — both create paths require at least
        # one line — but a direct-SQL edit could still empty a record.
        if await job_card_repo.item_count(session, source, entity_id) == 0:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Nothing to put on a job card — add line items first")

    from ..tasks.job_card import render_job_card

    render_job_card.delay(source, str(entity_id))
    logger.info("Queued job card render for %s %s", source, entity_id)
    return {"status": "queued", "source": source, "entity_id": str(entity_id)}


@router.post("/{source}/{entity_id}/send")
async def send_job_card_route(source: str, entity_id: UUID, req: SendRequest,
                              caller_uid: str = Depends(get_caller_uid)) -> dict:
    _check_source(source)
    if req.to == "workshop" and source != "order":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Workshop job cards come from an order — a quotation has no allocation yet",
        )
    async with get_api_session() as session:
        await _authorize(session, caller_uid, source, entity_id)
        if req.to == "workshop":
            recipients = await job_card_repo.workshop_recipients(session, entity_id)
            if not recipients:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="No active workshop is allocated to this order — allocate items first",
                )

    from ..tasks.job_card import send_job_card

    send_job_card.delay(source, str(entity_id), req.to)
    logger.info("Queued job card send for %s %s → %s", source, entity_id, req.to)
    return {"status": "queued", "source": source, "entity_id": str(entity_id), "to": req.to}


IMAGE_KIND = "job_card_image"
PDF_KIND = "job_card_pdf"


def _doc_kind(fmt: str) -> str:
    return IMAGE_KIND if fmt == "image" else PDF_KIND


@router.get("/{source}/{entity_id}/share")
async def job_card_share(source: str, entity_id: UUID,
                         caller_uid: str = Depends(get_caller_uid)) -> dict:
    """EVERY page of the latest job card, signed for sharing with ANYONE.

    Why this is separate from `/url`:

      * `/url` returns ONE key (`latest_storage_key`) because it exists to open the
        card in a tab. A job card rendered as images is one file PER PAGE, so a
        3-page card shared through `/url` shares only page 1 — silently.
      * A share link outlives the sharer's session. `/url` is a 1h convenience link;
        this one uses JOB_CARD_SHARE_TTL_SECONDS (7 days) because the recipient is
        outside the business and will not open it immediately.

    THE RECIPIENT IS NOT AUTHENTICATED, by design — that is what "share with anyone"
    means. The link is an unguessable signed Storage URL that expires. What limits
    the exposure is the artifact itself: a job card carries no prices, no totals and
    no contact details (migration 0027 + services/job_card_html). It DOES carry the
    customer's name and photos of their furniture, so:

      * the caller still needs write access to the customer (same gate as sending);
      * the share is recorded in `audit_log`, so "who sent this outside?" has an
        answer;
      * the link expires.

    Pages are batch-signed in one round-trip (services/storage.signed_urls_async).
    """
    _check_source(source)
    settings = get_settings()
    kind = _doc_kind(settings.JOB_CARD_FORMAT)
    async with get_api_session() as session:
        caller, customer_id = await _authorize(session, caller_uid, source, entity_id)
        keys = await document_repo.latest_storage_keys(session, source, entity_id, kind)
        if not keys:
            # JOB_CARD_FORMAT can be changed after a card was rendered, so fall back
            # to whatever IS on file. `kind` is reassigned, not just read: the format
            # reported below decides whether the dashboard hands the files to the OS
            # share sheet as images, so saying "image" about a PDF is a real bug.
            kind = PDF_KIND if kind == IMAGE_KIND else IMAGE_KIND
            keys = await document_repo.latest_storage_keys(session, source, entity_id, kind)
        if not keys:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Job card not generated yet")
        await audit_repo.record(
            session, entity=source, entity_id=entity_id, action="job_card_shared",
            actor=caller.salesperson_id,
            payload={"pages": len(keys), "customer_id": customer_id,
                     "ttl_seconds": settings.JOB_CARD_SHARE_TTL_SECONDS},
        )
        await session.commit()

    try:
        signed = await storage.signed_urls_async(
            settings.DOCUMENTS_BUCKET, keys, settings.JOB_CARD_SHARE_TTL_SECONDS
        )
    except storage.StorageError as exc:
        logger.error("Job card share sign failed for %s %s: %s", source, entity_id, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not generate the share link") from exc

    # Key order is page order (document_repo.latest_storage_keys). A page that failed
    # to sign is dropped rather than failing the share — but say so, because a
    # SILENTLY short job card is a worse outcome here than an error.
    pages = [{"url": signed[k], "filename": k.rsplit("/", 1)[-1]} for k in keys if k in signed]
    if len(pages) != len(keys):
        logger.warning("Job card share for %s %s signed %d of %d page(s)",
                       source, entity_id, len(pages), len(keys))
    if not pages:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not generate the share link")
    return {
        "pages": pages,
        "total_pages": len(keys),
        "format": "pdf" if kind == PDF_KIND else "image",
        "expires_in": settings.JOB_CARD_SHARE_TTL_SECONDS,
    }


@router.get("/{source}/{entity_id}/url")
async def job_card_url(source: str, entity_id: UUID,
                       caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Short-lived signed URL for the latest rendered job card."""
    _check_source(source)
    settings = get_settings()
    kind = _doc_kind(settings.JOB_CARD_FORMAT)
    async with get_api_session() as session:
        await _authorize(session, caller_uid, source, entity_id)
        key = await document_repo.latest_storage_key(session, source, entity_id, kind)
        if key is None:
            alt_kind = PDF_KIND if kind == IMAGE_KIND else IMAGE_KIND
            key = await document_repo.latest_storage_key(session, source, entity_id, alt_kind)
    if key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Job card not generated yet")
    try:
        url = await storage.signed_url_async(settings.DOCUMENTS_BUCKET, key)
    except storage.StorageError as exc:
        logger.error("Job card URL sign failed for %s %s: %s", source, entity_id, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not generate the job card link") from exc
    return {"url": url}
