"""Products + stock repository (0053). Raw SQL on an AsyncSession; the caller owns
the transaction.

─── THE PUBLIC READ IS AN ALLOWLIST ─────────────────────────────────────────────
`get_public_by_code` serves the customer-facing QR page through an unauthenticated
route, on the service-role connection where RLS does not apply. So the SELECT itself
is the boundary: it names PUBLIC_COLUMNS and nothing else, and never joins stock or
locations. Price, GST, HSN, stock and location are not fetched, so no later bug can
serialise them. tests/test_product_public.py pins the query text.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Exactly what a customer may see about a product. Adding a column here publishes it
# to anyone holding a sticker — it needs the same sign-off as a change to the page.
PUBLIC_COLUMNS: tuple[str, ...] = (
    "name", "category", "description", "sizes", "dimensions", "material", "finish",
)

# Columns the admin form writes. qr_code is absent on purpose — the DB assigns it and
# refuses to change it (0053).
EDITABLE_COLUMNS: tuple[str, ...] = (
    "name", "category", "description", "sizes", "dimensions", "material", "finish",
    "hsn", "gst_rate", "base_price", "unit", "stock_status",
)

_PHOTO_ORDER = (
    " ORDER BY coalesce(m.id = p.primary_media_id, false) DESC, m.created_at DESC, m.id"
)
_PHOTO_FILTER = (
    " FROM media m WHERE m.entity_type = 'product' AND m.entity_id = p.id"
    " AND m.status = 'ready'"
)

PUBLIC_PRODUCT_SQL = (
    "SELECT p.qr_code AS code, "
    + ", ".join(f"p.{c}" for c in PUBLIC_COLUMNS)
    + f", ARRAY(SELECT m.storage_key{_PHOTO_FILTER}{_PHOTO_ORDER} LIMIT :max_photos) AS photo_keys"
    + f", ARRAY(SELECT m.thumb_key{_PHOTO_FILTER}{_PHOTO_ORDER} LIMIT :max_photos) AS thumb_keys"
    + " FROM products p WHERE p.qr_code = :code AND p.active = true"
)


async def get_public_by_code(session: AsyncSession, code: str, *, max_photos: int) -> dict | None:
    """The customer view of an ACTIVE product, or None. Photo keys come primary-first;
    `thumb_keys[i]` belongs to `photo_keys[i]` (same ORDER BY, total by m.id)."""
    result = await session.execute(
        text(PUBLIC_PRODUCT_SQL), {"code": code, "max_photos": max_photos}
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def get_product(session: AsyncSession, product_id: UUID) -> dict | None:
    result = await session.execute(
        text(f"SELECT id, qr_code, active, {', '.join(EDITABLE_COLUMNS)} FROM products"
             " WHERE id = :id"),
        {"id": str(product_id)},
    )
    row = result.mappings().first()
    return None if row is None else dict(row)


async def create_product(session: AsyncSession, fields: dict) -> dict:
    """Insert and return {id, qr_code}. `fields` keys must be EDITABLE_COLUMNS."""
    cols = [c for c in EDITABLE_COLUMNS if c in fields]
    result = await session.execute(
        text(f"INSERT INTO products ({', '.join(cols)})"
             f" VALUES ({', '.join(f':{c}' for c in cols)}) RETURNING id, qr_code"),
        {c: fields[c] for c in cols},
    )
    return dict(result.mappings().one())


async def update_product(session: AsyncSession, product_id: UUID, fields: dict) -> None:
    cols = [c for c in EDITABLE_COLUMNS if c in fields]
    if not cols:
        return
    await session.execute(
        text(f"UPDATE products SET {', '.join(f'{c} = :{c}' for c in cols)} WHERE id = :id"),
        {**{c: fields[c] for c in cols}, "id": str(product_id)},
    )


async def lock_product(session: AsyncSession, product_id: UUID) -> None:
    """Row-lock the product for the rest of the transaction, so two saves of the same
    product serialise and the stale-stock check below cannot race."""
    await session.execute(
        text("SELECT 1 FROM products WHERE id = :id FOR UPDATE"), {"id": str(product_id)}
    )


async def active_location_ids(session: AsyncSession) -> set[str]:
    result = await session.execute(text("SELECT id FROM stock_locations WHERE active = true"))
    return {str(r[0]) for r in result.all()}


async def get_stock(session: AsyncSession, product_id: UUID) -> dict[str, int]:
    """{location_id: quantity} for one product."""
    result = await session.execute(
        text("SELECT location_id, quantity FROM product_stock WHERE product_id = :id"),
        {"id": str(product_id)},
    )
    return {str(r[0]): int(r[1]) for r in result.all()}


async def upsert_stock(
    session: AsyncSession, product_id: UUID, quantities: dict[str, int], *, actor_id: str
) -> None:
    """Set each location's quantity in ONE statement. Unchanged rows are not touched,
    so `updated_at`/`updated_by` keep meaning "last real change"."""
    if not quantities:
        return
    location_ids = list(quantities)
    await session.execute(
        text(
            "INSERT INTO product_stock (product_id, location_id, quantity, updated_by)"
            " SELECT :pid, q.location_id, q.quantity, :actor"
            " FROM unnest(cast(:location_ids as uuid[]), cast(:quantities as int[]))"
            "   AS q(location_id, quantity)"
            " ON CONFLICT (product_id, location_id) DO UPDATE"
            "   SET quantity = excluded.quantity, updated_by = excluded.updated_by"
            "   WHERE product_stock.quantity IS DISTINCT FROM excluded.quantity"
        ),
        {
            "pid": str(product_id),
            "actor": actor_id,
            "location_ids": location_ids,
            "quantities": [quantities[k] for k in location_ids],
        },
    )


async def sticker_rows(session: AsyncSession, product_ids: list[UUID]) -> list[dict]:
    """name + qr_code for each requested product, in REQUEST order (the admin's
    selection order is the print order). Unknown ids are dropped."""
    result = await session.execute(
        text("SELECT id, name, qr_code FROM products WHERE id = ANY(cast(:ids as uuid[]))"),
        {"ids": [str(i) for i in product_ids]},
    )
    by_id = {str(r["id"]): dict(r) for r in result.mappings().all()}
    return [by_id[str(i)] for i in product_ids if str(i) in by_id]


def stale_locations(current: dict[str, int], loaded: dict[str, int]) -> list[str]:
    """Locations whose stock moved since the editor loaded the form (missing ⇒ 0).
    Non-empty means saving would silently overwrite someone else's count."""
    return [loc for loc, qty in loaded.items() if current.get(loc, 0) != qty]


def stock_changes(before: dict[str, int], after: dict[str, int]) -> dict[str, list[int]]:
    """{location_id: [old, new]} for every location whose quantity moved — the audit
    payload. A location absent before counts as 0."""
    return {
        loc: [before.get(loc, 0), qty]
        for loc, qty in after.items()
        if before.get(loc, 0) != qty
    }
