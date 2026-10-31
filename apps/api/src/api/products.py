"""Products API — create/edit with stock, the QR image, sticker PDFs (0053).

Writes come through here rather than straight to Supabase because a product save is
the product row AND its stock at four locations: one transaction, validated as a
whole, audited with the stock delta. product_stock has no browser write grant at all.

Reads stay on Supabase under RLS (list, detail, staff scan view) — the house pattern.
The customer-facing read is api/public_products.py, not this router.

Who: create/edit/print = roles.PRODUCT_MANAGE (owner-level + admin). The QR image is
for any staff member (it encodes nothing a sticker does not already show).
Deactivation stays on the existing dashboard action (NO_REMOVAL applies there).
"""

import logging
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator

from ..config import get_settings
from ..database import get_api_session
from ..repositories import audit_repo, product_repo
from ..services import product_codes, qr_stickers, roles, storage
from . import authz
from .deps import get_caller_uid, require_dashboard_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/products", dependencies=[Depends(require_dashboard_key)])

StockStatus = Literal["in_stock", "low_stock", "out_of_stock", "made_to_order"]


class StockLine(BaseModel):
    location_id: UUID
    quantity: int = Field(ge=0, le=100_000)


class ProductSave(BaseModel):
    """The whole editable record. A full replace (PUT semantics) on purpose: the
    mobile form always sends every field, so "omitted" vs "cleared" never arises."""

    name: str = Field(min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=4000)
    sizes: str | None = Field(default=None, max_length=300)
    dimensions: str | None = Field(default=None, max_length=300)
    material: str | None = Field(default=None, max_length=200)
    finish: str | None = Field(default=None, max_length=200)
    base_price: Decimal | None = Field(default=None, ge=0, le=Decimal("9999999999.99"))
    gst_rate: Decimal = Field(default=Decimal(18), ge=0, le=Decimal("99.99"))
    hsn: str = Field(default="9403", pattern=r"^[0-9]{4,8}$")
    unit: str = Field(default="nos", min_length=1, max_length=20)
    stock_status: StockStatus = "in_stock"
    stock: list[StockLine] = Field(default_factory=list, max_length=50)
    # Edit only: the quantities the form was LOADED with. When present, a save is
    # refused (409) if any of them moved since — two people counting the Godown at
    # once must not silently overwrite each other.
    stock_loaded: list[StockLine] | None = Field(default=None, max_length=50)

    @field_validator("name", "category", "description", "sizes", "dimensions",
                     "material", "finish", "hsn", "unit", mode="before")
    @classmethod
    def _strip(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @model_validator(mode="after")
    def _one_line_per_location(self):
        ids = [line.location_id for line in self.stock]
        if len(ids) != len(set(ids)):
            raise ValueError("Each location may appear only once in the stock list")
        return self

    def loaded_quantities(self) -> dict[str, int] | None:
        if self.stock_loaded is None:
            return None
        return {str(line.location_id): line.quantity for line in self.stock_loaded}

    def product_fields(self) -> dict:
        return self.model_dump(include=set(product_repo.EDITABLE_COLUMNS))

    def quantities(self) -> dict[str, int]:
        return {str(line.location_id): line.quantity for line in self.stock}


class StickerRequest(BaseModel):
    product_ids: list[UUID] = Field(min_length=1, max_length=300)
    size: Literal["small", "medium", "large"] = "small"
    layout: Literal["sheet", "roll"] = "sheet"
    copies: int = Field(default=1, ge=1, le=20)


async def _manager(session, uid: str) -> authz.Caller:
    caller = await authz.resolve_caller(session, uid)
    authz.assert_role(caller, set(roles.PRODUCT_MANAGE), action="manage products and stock")
    return caller


async def _check_locations(session, body: ProductSave) -> None:
    unknown = set(body.quantities()) - await product_repo.active_location_ids(session)
    if unknown:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Stock names a location that does not exist or is retired"
                                   " — refresh the page and try again")


def _qr_url(code: str) -> str:
    settings = get_settings()
    base = product_codes.qr_base_url(settings.PRODUCT_QR_BASE_URL, settings.DASHBOARD_URL)
    return product_codes.product_url(base, code)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_product(body: ProductSave, uid: str = Depends(get_caller_uid)) -> dict:
    async with get_api_session() as session:
        caller = await _manager(session, uid)
        await _check_locations(session, body)
        created = await product_repo.create_product(session, body.product_fields())
        await product_repo.upsert_stock(session, created["id"], body.quantities(),
                                        actor_id=caller.salesperson_id)
        await audit_repo.record(
            session, entity="product", entity_id=created["id"], action="product_created",
            actor=caller.salesperson_id,
            payload={**body.product_fields(),
                     "stock": product_repo.stock_changes({}, body.quantities())},
        )
        await session.commit()
    code = created["qr_code"]
    return {"id": str(created["id"]), "qr_code": code, "url": _qr_url(code)}


@router.put("/{product_id}")
async def update_product(
    product_id: UUID, body: ProductSave, uid: str = Depends(get_caller_uid)
) -> dict:
    async with get_api_session() as session:
        caller = await _manager(session, uid)
        existing = await product_repo.get_product(session, product_id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
        await _check_locations(session, body)
        await product_repo.lock_product(session, product_id)
        before = await product_repo.get_stock(session, product_id)
        loaded = body.loaded_quantities()
        if loaded is not None and product_repo.stale_locations(before, loaded):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Someone changed this product's stock after you opened the form —"
                       " reload the page and enter your change again",
            )
        await product_repo.update_product(session, product_id, body.product_fields())
        await product_repo.upsert_stock(session, product_id, body.quantities(),
                                        actor_id=caller.salesperson_id)
        changed_fields = {k: v for k, v in body.product_fields().items() if existing.get(k) != v}
        stock_moves = product_repo.stock_changes(before, body.quantities())
        if changed_fields or stock_moves:
            await audit_repo.record(
                session, entity="product", entity_id=product_id, action="product_updated",
                actor=caller.salesperson_id,
                payload={"fields": changed_fields, "stock": stock_moves},
            )
        await session.commit()
    code = existing["qr_code"]
    return {"id": str(product_id), "qr_code": code, "url": _qr_url(code)}


@router.get("/{product_id}/qr")
async def product_qr(product_id: UUID, uid: str = Depends(get_caller_uid)) -> dict:
    """The sticker's QR as an SVG data URI, for the product page preview."""
    async with get_api_session() as session:
        caller = await authz.resolve_caller(session, uid)
        authz.assert_role(caller, set(roles.STOCK_VIEW), action="view product QR codes")
        product = await product_repo.get_product(session, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    url = _qr_url(product["qr_code"])
    return {"code": product["qr_code"], "url": url, "image": qr_stickers.qr_data_uri(url)}


def _enqueue_sticker_render(job_id: str, products: list[dict], body: "StickerRequest", base_url: str) -> None:
    # Lazy: tasks.qr_stickers drags Celery + Playwright into the web process
    # (import-light rule), same as quotations._enqueue_pdf_render.
    from ..tasks.qr_stickers import render_qr_stickers

    render_qr_stickers.delay(job_id, products, body.size, body.layout, body.copies, base_url)


@router.post("/stickers", status_code=status.HTTP_202_ACCEPTED)
async def queue_sticker_pdf(body: StickerRequest, uid: str = Depends(get_caller_uid)) -> dict:
    """Queue a printable PDF of QR stickers (A4 sheet, or one per label for a roll
    printer). Headless Chromium spikes ~1GB per render, so it runs in the Celery worker,
    never in the 1GB api container (infra/hetzner/docker-compose.prod.yml). Poll
    GET /products/stickers/{job_id} for the signed URL."""
    settings = get_settings()
    unique_ids = list(dict.fromkeys(body.product_ids))
    if len(unique_ids) * body.copies > settings.PRODUCT_QR_MAX_STICKERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"At most {settings.PRODUCT_QR_MAX_STICKERS} stickers per PDF —"
                   " print in smaller batches or fewer copies",
        )
    async with get_api_session() as session:
        await _manager(session, uid)
        rows = await product_repo.sticker_rows(session, unique_ids)
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="None of the selected products exist any more")

    # Only what a sticker prints travels to the worker: name + code, never a price.
    products = [{"name": r["name"], "qr_code": r["qr_code"]} for r in rows]
    base = product_codes.qr_base_url(settings.PRODUCT_QR_BASE_URL, settings.DASHBOARD_URL)
    job_id = str(uuid4())
    try:
        _enqueue_sticker_render(job_id, products, body, base)
    except Exception as exc:  # a broker hiccup is not a 500 for the operator
        logger.warning("Could not enqueue sticker render (%d products): %s", len(products), exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not start the sticker PDF — try again in a moment") from exc
    return {"job_id": job_id, "count": len(products) * body.copies}


@router.get("/stickers/{job_id}")
async def sticker_pdf_url(job_id: UUID, uid: str = Depends(get_caller_uid)) -> dict:
    """Signed URL of a finished sticker PDF; 404 until the worker has stored it."""
    settings = get_settings()
    async with get_api_session() as session:
        await _manager(session, uid)
    key = qr_stickers.sticker_pdf_key(job_id)
    try:
        if await storage.object_size_async(settings.DOCUMENTS_BUCKET, key) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Sticker PDF not ready yet")
        url = await storage.signed_url_async(
            settings.DOCUMENTS_BUCKET, key, expires_in=settings.PRODUCT_QR_PDF_URL_TTL_S
        )
    except storage.StorageError as exc:
        logger.error("Sticker PDF lookup failed for %s: %s", job_id, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Could not fetch the sticker PDF — try again") from exc
    return {"url": url, "filename": f"topaz-qr-stickers-{str(job_id)[:8]}.pdf"}
