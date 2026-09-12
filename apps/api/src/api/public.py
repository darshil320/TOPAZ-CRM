"""Public, token-gated quotation endpoints (module 03).

NO auth key — the single-use `approval_token` (uuid) in the URL is the
capability. Unknown/expired tokens 404 uniformly (a uuid is not brute-forceable,
but responses never distinguish "wrong token" from "expired"). This router is
registered WITHOUT the dashboard-key dependency; the dashboard middleware must
exclude the matching public page route (/q).
"""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from ..config import get_settings
from ..database import get_api_session
from ..repositories import job_card_repo, quotation_repo as repo
from ..services import storage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/public")

# Pipeline stage a decision moves the customer to.
_APPROVE_STAGE = "order_confirmed"
_REJECT_STAGE = "negotiation"


def _client_ip(request: Request) -> str | None:
    """Best-effort client IP for the audit trail. Uses the LAST hop of
    X-Forwarded-For (the value the trusted proxy appended) rather than the
    leftmost (client-settable) entry, which is spoofable (security-review
    MEDIUM). Audit-only — never used for an authz decision."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        hops = [h.strip() for h in fwd.split(",") if h.strip()]
        if hops:
            return hops[-1]
    return request.client.host if request.client else None


@router.get("/quotes/{token}")
async def public_quote(token: UUID) -> dict:
    """Customer-facing quote summary. Marks the quote 'viewed' on first open.

    Line photos: resolved with the SAME precedence the job card and priced PDF
    already use (job_card_repo.resolve_photo_keys is explicitly PUBLIC for this
    reason — a customer holding this page and a workshop holding the job card
    must agree about what a line looks like). Unlike those two, this is a live
    JSON response re-fetched on every visit rather than a rendered document, so
    photos are handed back as short-lived SIGNED URLS (mirrors the job-card
    /share pattern) instead of inlined base64 bytes.
    """
    async with get_api_session() as session:
        summary = await repo.get_public_summary(session, token)
        if summary is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote not found")
        summary["items"] = await job_card_repo.resolve_photo_keys(
            session, "quotation", summary["items"]
        )
        await repo.mark_viewed(session, token)
        await session.commit()

    # Signing is a Storage HTTP call — kept outside the DB session/transaction.
    settings = get_settings()
    keys = [it["photo_key"] for it in summary["items"] if it.get("photo_key")]
    signed: dict[str, str] = {}
    if keys:
        try:
            signed = await storage.signed_urls_async(
                settings.MEDIA_BUCKET, keys, settings.MEDIA_URL_TTL_SECONDS
            )
        except storage.StorageError as exc:
            # Fails soft: a Storage hiccup must not blank the whole quote or
            # block approve/reject. Every item just gets photo_url=None.
            logger.warning("Could not sign quote photo URLs for token %s: %s", token, exc)

    for it in summary["items"]:
        it["photo_url"] = signed.get(it.get("photo_key"))
        it.pop("photo_key", None)
        it.pop("id", None)
        it.pop("product_id", None)

    # Never leak internal ids/tokens to the browser beyond what's needed.
    summary.pop("id", None)
    summary.pop("customer_id", None)
    summary.pop("pdf_key", None)
    return summary


async def _decide(token: UUID, request: Request, *, approve: bool) -> dict:
    ip = _client_ip(request)
    async with get_api_session() as session:
        decision = await repo.record_decision(session, token, approve=approve, ip=ip)
        if decision is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote not found")
        if decision["changed"]:
            await repo.upsert_pipeline_stage(
                session, decision["customer_id"], _APPROVE_STAGE if approve else _REJECT_STAGE
            )
        await session.commit()

    # Notify only on the real transition (idempotent: a repeat POST won't re-alert).
    if decision["changed"]:
        from ..tasks.quotes import notify_quote_decision
        notify_quote_decision.delay(decision["id"], approve)
    return {"status": decision["status"], "changed": decision["changed"]}


@router.post("/quotes/{token}/approve")
async def approve_quote(token: UUID, request: Request) -> dict:
    return await _decide(token, request, approve=True)


@router.post("/quotes/{token}/reject")
async def reject_quote(token: UUID, request: Request) -> dict:
    return await _decide(token, request, approve=False)
