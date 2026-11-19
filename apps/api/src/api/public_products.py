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

No photos: customers see text details only (client decision, 2026-11-19). Staff still
see photos in their own view.

An unknown, malformed or deactivated code is a uniform 404 — the response never says
which, so codes cannot be probed for "exists but hidden".
"""

import logging

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict

from ..database import get_api_session
from ..repositories import product_repo
from ..services import product_codes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/public/products")


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


_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")


def to_public(row: dict) -> PublicProduct:
    """Build the response from the allowlist only — never `**row`."""
    return PublicProduct(code=row["code"], **{c: row.get(c) for c in product_repo.PUBLIC_COLUMNS})


@router.get("/{code}", response_model=PublicProduct)
async def public_product(code: str, response: Response) -> PublicProduct:
    canonical = product_codes.normalize_code(code)
    if canonical is None:
        raise _NOT_FOUND
    async with get_api_session() as session:
        row = await product_repo.get_public_by_code(session, canonical)
    if row is None:
        raise _NOT_FOUND

    # Edits must show on the next scan: nothing may cache this.
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"
    return to_public(row)
