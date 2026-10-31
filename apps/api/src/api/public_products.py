"""Customer-facing product lookup for the QR sticker page (0053).

NO auth, NO dashboard key — whoever holds the sticker holds the code. Registered
without require_dashboard_key, like the public quote route; the dashboard page that
calls it (/p/[code]) renders server-side, so the browser never sees this API either.

THE STRICT RULE: price, GST, HSN, stock and location never leave this route. Three
things hold it, any one of which is enough:
  1. product_repo.PUBLIC_PRODUCT_SQL selects an allowlist — the forbidden columns
     are never read;
  2. `PublicProduct` is the response_model with extra="forbid", so FastAPI serialises
     those fields and nothing else even if a future change put more in the dict;
  3. tests/test_product_public.py pins both.

An unknown, malformed or deactivated code is a uniform 404 — the response never says
which, so codes cannot be probed for "exists but hidden".
"""

import logging

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict

from ..config import get_settings
from ..database import get_api_session
from ..repositories import product_repo
from ..services import product_codes, storage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/public/products")


class PublicPhoto(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    thumb_url: str | None = None


class PublicProduct(BaseModel):
    """Everything a customer may see. Adding a field here publishes it to anyone who
    scans a sticker — same sign-off as product_repo.PUBLIC_COLUMNS."""

    model_config = ConfigDict(extra="forbid")

    code: str
    name: str
    category: str | None = None
    description: str | None = None
    sizes: str | None = None
    dimensions: str | None = None
    material: str | None = None
    finish: str | None = None
    photos: list[PublicPhoto] = []


_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")


async def _sign_photos(row: dict) -> list[PublicPhoto]:
    """Signed URLs for the photos, full + thumbnail, in ONE Storage round-trip. Fails
    soft: a Storage hiccup costs the photos, never the page."""
    keys = [k for k in row.get("photo_keys") or [] if k]
    thumbs = list(row.get("thumb_keys") or [])
    if not keys:
        return []
    settings = get_settings()
    wanted = keys + [t for t in thumbs if t]
    try:
        signed = await storage.signed_urls_async(
            settings.MEDIA_BUCKET, wanted, settings.MEDIA_URL_TTL_SECONDS
        )
    except storage.StorageError as exc:
        logger.warning("Could not sign product photos for %s: %s", row.get("code"), exc)
        return []
    photos = []
    for i, key in enumerate(keys):
        url = signed.get(key)
        if url is None:
            continue
        thumb_key = thumbs[i] if i < len(thumbs) else None
        photos.append(PublicPhoto(url=url, thumb_url=signed.get(thumb_key) if thumb_key else None))
    return photos


def to_public(row: dict, photos: list[PublicPhoto]) -> PublicProduct:
    """Build the response from the allowlist only — never `**row`."""
    return PublicProduct(
        code=row["code"],
        **{c: row.get(c) for c in product_repo.PUBLIC_COLUMNS},
        photos=photos,
    )


@router.get("/{code}", response_model=PublicProduct)
async def public_product(code: str, response: Response) -> PublicProduct:
    canonical = product_codes.normalize_code(code)
    if canonical is None:
        raise _NOT_FOUND
    settings = get_settings()
    async with get_api_session() as session:
        row = await product_repo.get_public_by_code(
            session, canonical, max_photos=settings.PRODUCT_PUBLIC_MAX_PHOTOS
        )
    if row is None:
        raise _NOT_FOUND

    photos = await _sign_photos(row)
    # Signed URLs expire and edits must show on the next scan: nothing may cache this.
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"
    return to_public(row, photos)
