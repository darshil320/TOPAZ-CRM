"""Quotations API — draft create / update / revise / soft-delete.

Writes only (dashboard reads quotations directly from Supabase under RLS, §19-G),
plus the Share button's PDF pair — the PDF lives in the PRIVATE documents bucket, so
its signed URL needs the service-role key and can only come from here.
Totals are ALWAYS computed server-side from the line items (gst.py); the client
never supplies money. Numbers come from the atomic allocator (numbering.py).
Send + public approval endpoints live in module 03.
"""

import logging
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..config import get_settings
from ..database import get_api_session
from ..repositories import assignment_repo, quotation_repo as repo
from ..services import gst, numbering, roles, storage
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/quotations", dependencies=[Depends(require_dashboard_key)])


# ─── request models ───────────────────────────────────────────────────────────

class QuoteItemIn(BaseModel):
    description: str = Field(min_length=1)
    qty: Decimal = Field(gt=0)
    unit_price: Decimal = Field(ge=0)
    hsn: str = Field(min_length=1)
    gst_rate: Decimal = Field(ge=0, le=100)
    product_id: UUID | None = None
    dimensions: str | None = None
    material: str | None = None
    fabric: str | None = None
    polish: str | None = None
    customization: str | None = None
    spec_notes: str | None = None
    unit: str | None = None


class QuoteCreate(BaseModel):
    customer_id: UUID
    items: list[QuoteItemIn] = Field(min_length=1)
    discount: Decimal = Field(default=Decimal(0), ge=0)
    place_of_supply: str = "GJ"
    valid_until: date | None = None
    terms: str | None = None
    notes: str | None = None
    # (created_by is derived from the verified caller token, not the body — unless a
    # dispatcher names the salesperson the quotation is FOR; see _quote_owner.)
    salesperson_id: UUID | None = None


class QuoteUpdate(BaseModel):
    items: list[QuoteItemIn] = Field(min_length=1)
    discount: Decimal = Field(default=Decimal(0), ge=0)
    place_of_supply: str = "GJ"
    valid_until: date | None = None
    terms: str | None = None
    notes: str | None = None


# ─── helpers ────────────────────────────────────────────────────────────────

def _compute(items: list[QuoteItemIn], discount: Decimal, place_of_supply: str):
    """Server-side totals + per-line totals. Never trust client money."""
    settings = get_settings()
    lines = [gst.LineInput(qty=it.qty, unit_price=it.unit_price, gst_rate=it.gst_rate) for it in items]
    totals = gst.compute_document(lines, discount, place_of_supply, settings.HOME_STATE)
    repo_items = [
        repo.QuoteItem(
            description=it.description, qty=it.qty, unit_price=it.unit_price, hsn=it.hsn,
            gst_rate=it.gst_rate, line_total=gst.compute_line(it.qty, it.unit_price).line_total,
            product_id=it.product_id, dimensions=it.dimensions, material=it.material,
            fabric=it.fabric, polish=it.polish, customization=it.customization, spec_notes=it.spec_notes,
            unit=it.unit, sort=i,
        )
        for i, it in enumerate(items)
    ]
    return totals, repo_items


def _default_valid_until(supplied: date | None) -> date:
    if supplied:
        return supplied
    return date.today() + timedelta(days=get_settings().QUOTE_VALIDITY_DAYS)


# ─── endpoints ────────────────────────────────────────────────────────────────

async def _quote_owner(session, caller: authz.Caller, requested: UUID | None) -> UUID:
    """Whose quotation this is — becomes created_by.

    Normally the caller. A dispatcher (front desk, admin, owner-level) may name the
    salesperson it is FOR (0052); the front desk must, since it never sells itself.
    """
    if requested is None or str(requested) == caller.salesperson_id:
        if caller.role == "front_desk":
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="Choose the salesperson this quotation is for")
        return UUID(caller.salesperson_id)
    if caller.role not in roles.DISPATCH:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the front desk, an admin or the owner may prepare a quotation for someone else",
        )
    if await assignment_repo.get_selling_staff(session, requested) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Choose an active salesperson")
    return requested


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_quotation(req: QuoteCreate, caller_uid: str = Depends(get_caller_uid)) -> dict:
    totals, items = _compute(req.items, req.discount, req.place_of_supply)
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, caller_uid)
        owner_id = await _quote_owner(session, caller, req.salesperson_id)
        await authz.assert_can_write_quote(session, caller, str(req.customer_id))
        on_behalf = str(owner_id) != caller.salesperson_id
        if on_behalf:
            # q_select is assignment-scoped: without this the salesperson could not
            # open the quotation that was prepared for them.
            try:
                await assignment_repo.ensure_assigned(
                    session, customer_id=req.customer_id, salesperson_id=owner_id,
                    added_by=UUID(caller.salesperson_id),
                )
            except LookupError as exc:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                    detail="Customer not found") from exc
            except assignment_repo.ConsentWithdrawn as exc:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail="This customer withdrew their consent") from exc
        quote_no = await numbering.allocate(session, "QTN")
        # `_returning` rather than create-then-read: the record comes back from the
        # two INSERTs' own RETURNING clauses, so this route is 4 round-trips + 1 per
        # line item lighter than it was.
        result = await repo.create_quotation_returning(
            session, quote_no=quote_no, customer_id=req.customer_id, totals=totals, items=items,
            place_of_supply=req.place_of_supply, valid_until=_default_valid_until(req.valid_until),
            terms=req.terms, notes=req.notes, created_by=owner_id,
            prepared_by=UUID(caller.salesperson_id) if on_behalf else None,
        )
        await session.commit()
    logger.info("Created quotation %s (%s) for %s by %s", quote_no, result["id"], owner_id,
                caller.salesperson_id)
    return result


async def _authorize(session, caller_uid: str, quotation_id: UUID) -> authz.Caller:
    """Resolve the caller and assert they may write this quotation's customer.
    404 if the quotation doesn't exist. Returns the Caller.

    The front desk CREATES quotations for any customer, but afterwards may edit, revise,
    send or delete only the ones it prepared itself (0052) — not every quotation in the
    showroom, which would let it reprice or send another salesperson's work.
    """
    caller = await authz.resolve_caller(session, caller_uid)
    ctx = await repo.get_write_context(session, quotation_id)
    if ctx is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    if caller.role == "front_desk" and str(ctx["prepared_by"]) != caller.salesperson_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="The front desk can only change quotations it prepared")
    await authz.assert_can_write_quote(session, caller, str(ctx["customer_id"]))
    return caller


@router.put("/{quotation_id}")
async def update_quotation(quotation_id: UUID, req: QuoteUpdate,
                           caller_uid: str = Depends(get_caller_uid)) -> dict:
    totals, items = _compute(req.items, req.discount, req.place_of_supply)
    async with get_api_session() as session:
        await _authorize(session, caller_uid, quotation_id)
        ok = await repo.update_draft(
            session, quotation_id, totals=totals, items=items,
            place_of_supply=req.place_of_supply, valid_until=req.valid_until,
            terms=req.terms, notes=req.notes,
        )
        if not ok:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Only draft quotations can be edited")
        result = await repo.get_quotation(session, quotation_id)
        await session.commit()
    return result


@router.post("/{quotation_id}/revise", status_code=status.HTTP_201_CREATED)
async def revise_quotation(quotation_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        caller = await _authorize(session, caller_uid, quotation_id)
        new_quote_no = await numbering.allocate(session, "QTN")
        new_id = await repo.clone_for_revision(
            session, quotation_id, new_quote_no=new_quote_no,
            revised_by=UUID(caller.salesperson_id),
        )
        if new_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found")
        result = await repo.get_quotation(session, new_id)
        await session.commit()
    logger.info("Revised quotation %s -> %s (%s)", quotation_id, new_quote_no, new_id)
    return result


@router.delete("/{quotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_quotation(quotation_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> None:
    async with get_api_session() as session:
        caller = await _authorize(session, caller_uid, quotation_id)
        authz.assert_may_remove(caller, action="delete a quotation")
        ok = await repo.soft_delete_draft(session, quotation_id)
        if not ok:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Only draft quotations can be deleted")
        await session.commit()


@router.post("/{quotation_id}/send", status_code=status.HTTP_202_ACCEPTED)
async def send_quotation(quotation_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Render (if needed) + WhatsApp the quote to the customer, advancing it to
    'sent'. Draft-only; the render + send + status flip happen in the worker."""
    async with get_api_session() as session:
        await _authorize(session, caller_uid, quotation_id)
        current = await repo.get_status(session, quotation_id)
    if current is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    if current != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Only draft quotations can be sent (status: {current})")
    from ..tasks.quotes import send_quotation as send_task
    send_task.delay(str(quotation_id))
    logger.info("Queued send for quotation %s", quotation_id)
    return {"quotation_id": str(quotation_id), "queued": True}


# ─── share: the quotation PDF ────────────────────────────────────────────────
# Two calls, same shape as the delivery challan (api/documents.py): rendering runs
# headless Chromium (~1GB per render), which must stay in the Celery worker — the
# api container is capped at 1GB. POST queues it; GET returns a signed URL, 404 until
# the worker has filed one. Read access is enough: sharing contacts nobody by itself,
# and accounts share quotations as much as sales do.

def _enqueue_pdf_render(quotation_id: str) -> None:
    # Lazy: tasks.pdf drags Celery + Playwright into the web process (import-light rule).
    from ..tasks.pdf import render_quotation_pdf as render_task

    render_task.delay(quotation_id)


async def _authorize_read(session, caller_uid: str, quotation_id: UUID) -> dict:
    """The quotation's PDF info, after the caller's read check.

    An unknown id is 404 before the access check (same order as the challan route).
    A deleted draft (soft-deleted to 'expired') is 409: it must not keep circulating
    with prices on it.
    """
    caller = await authz.resolve_caller(session, caller_uid)
    info = await repo.get_pdf_info(session, quotation_id)
    if info is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    await authz.assert_can_read_quote(session, caller, str(info["customer_id"]))
    if info["status"] == "expired":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="This quotation was deleted and cannot be shared")
    return info


@router.post("/{quotation_id}/pdf", status_code=status.HTTP_202_ACCEPTED)
async def render_quotation_pdf(quotation_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """Queue a render of the quotation as it stands now. The dashboard polls GET."""
    async with get_api_session() as session:
        info = await _authorize_read(session, caller_uid, quotation_id)
    try:
        _enqueue_pdf_render(str(quotation_id))
    except Exception as exc:  # noqa: BLE001 — a broker hiccup is not a 500 for the operator
        logger.warning("Could not enqueue quotation PDF render for %s: %s", quotation_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not start preparing the PDF — try again in a moment",
        ) from exc
    logger.info("Quotation PDF render queued for %s", quotation_id)
    return {"status": "queued", "quote_no": info["quote_no"]}


@router.get("/{quotation_id}/pdf")
async def quotation_pdf_url(quotation_id: UUID, caller_uid: str = Depends(get_caller_uid)) -> dict:
    """A signed URL for the quotation's CURRENT PDF. 404 while none exists (never
    rendered, or edited since — update_draft clears pdf_key)."""
    settings = get_settings()
    async with get_api_session() as session:
        info = await _authorize_read(session, caller_uid, quotation_id)
    if not info["pdf_key"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Quotation PDF not ready yet")
    try:
        url = await storage.signed_url_async(
            settings.DOCUMENTS_BUCKET, info["pdf_key"], expires_in=settings.QUOTE_SHARE_URL_TTL_S
        )
    except storage.StorageError as exc:
        logger.error("Quotation PDF URL sign failed for %s: %s", quotation_id, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not create the share link — try again") from exc
    return {
        "url": url,
        "quote_no": info["quote_no"],
        "filename": f"{info['quote_no']}.pdf",
        "expires_in": settings.QUOTE_SHARE_URL_TTL_S,
    }
