"""Job card data assembly — header + items + the resolved photo for each line.

Reads only. One shape for both sources (quotation and order) so the renderer and
the template never branch on which one it came from.

MONEY IS NEVER SELECTED HERE. The item queries deliberately omit unit_price,
line_total, hsn and gst_rate — a job card that cannot fetch a price cannot leak one
to a workshop. See migration 0027's header.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Photo resolution order for one line, first hit wins:
#   1. the line's OWN media (a custom piece photographed for this job)
#   2. the product's explicitly chosen catalog photo (products.primary_media_id)
#   3. the product's newest ready 'reference' media (a photo was uploaded but no
#      primary was ever set — still better than a blank cell)
#   4. nothing → the template prints "No photo"
_LINE_ENTITY = {"quotation": "quotation_item", "order": "order_item"}


async def _line_photo_key(session: AsyncSession, entity_type: str, item_id) -> str | None:
    result = await session.execute(
        text(
            # Prefer the 400px thumbnail: it is ample for a ~50mm print cell and
            # keeps the PDF small. thumb_key is NULL whenever the thumbnail worker
            # hasn't run or failed, so coalesce back to the full image.
            "SELECT coalesce(thumb_key, storage_key) FROM media"
            " WHERE entity_type = :et AND entity_id = :eid AND status = 'ready'"
            " ORDER BY created_at DESC LIMIT 1"
        ),
        {"et": entity_type, "eid": str(item_id)},
    )
    row = result.first()
    return None if row is None else str(row[0])


async def _product_photo_key(session: AsyncSession, product_id) -> str | None:
    if product_id is None:
        return None
    chosen = await session.execute(
        text(
            # The entity_type/entity_id predicate is LOAD-BEARING, not belt-and-braces.
            # products.primary_media_id is a bare FK to media(id) — nothing in the
            # schema stops it pointing at a customer's 'site' photo (the interior of
            # somebody's home). Without this clause that photo would be inlined into
            # a job card and WhatsApped to an outside vendor workshop. Enforced here
            # as well as at the write, so a bad pointer set by any route is inert.
            "SELECT coalesce(m.thumb_key, m.storage_key) FROM products p"
            " JOIN media m ON m.id = p.primary_media_id"
            " WHERE p.id = :pid AND m.status = 'ready'"
            "   AND m.entity_type = 'product' AND m.entity_id = p.id"
        ),
        {"pid": str(product_id)},
    )
    row = chosen.first()
    if row is not None:
        return str(row[0])
    return await _line_photo_key(session, "product", product_id)


_ITEM_TABLES = {
    "quotation": ("quotation_items", "quotation_id"),
    "order": ("order_items", "order_id"),
}


async def item_count(session: AsyncSession, source: str, parent_id: UUID) -> int:
    """How many lines a job card would have. Deliberately cheap — callers use this
    to reject an empty card without paying for the full header + photo resolution."""
    table, fk = _ITEM_TABLES[source]
    result = await session.execute(
        text(f"SELECT count(*) FROM {table} WHERE {fk} = :pid"), {"pid": str(parent_id)}
    )
    return int(result.scalar_one())


async def resolve_photo_keys(session: AsyncSession, source: str, items: list[dict]) -> list[dict]:
    """Attach `photo_key` to each item. Returns NEW dicts — inputs are not mutated.

    PUBLIC because the priced QUOTATION PDF now shows the same photos (tasks/pdf.py).
    Both documents must agree about what a line looks like: a customer holding the
    quotation and a workshop holding the job card are looking at the same piece of
    furniture, so the resolution order — line photo, then catalog photo, then nothing
    — lives here once rather than being re-implemented per document.

    Note the money boundary is NOT weakened by sharing this: it resolves photo KEYS
    only. `_product_photo_key`'s entity_type guard is what keeps a customer's private
    'site' photo out of both documents, and it applies to both callers.

    N+1 by construction: 1 query per item, plus up to 2 more when it falls back to
    the product. Deliberate for now — a quote or card is 1-10 lines and this runs once
    per render in a background worker, so a batched LATERAL join would trade real
    clarity for unmeasurable time. Revisit if a bulk "render all pending" ever ships.
    """
    line_entity = _LINE_ENTITY[source]
    resolved = []
    for it in items:
        key = await _line_photo_key(session, line_entity, it["id"])
        if key is None:
            key = await _product_photo_key(session, it.get("product_id"))
        resolved.append({**it, "photo_key": key})
    return resolved


async def _items(session: AsyncSession, table: str, fk: str, parent_id: UUID) -> list[dict]:
    result = await session.execute(
        text(
            "SELECT it.id, it.product_id, it.description, it.dimensions, it.material,"
            "       it.fabric, it.polish, it.customization, it.spec_notes, it.qty, it.unit,"
            "       p.name AS product_name"
            f" FROM {table} it"
            " LEFT JOIN products p ON p.id = it.product_id"
            f" WHERE it.{fk} = :pid"
            " ORDER BY it.sort, it.id"
        ),
        {"pid": str(parent_id)},
    )
    return [dict(m) for m in result.mappings().all()]


async def quotation_job_card(session: AsyncSession, quotation_id: UUID) -> dict | None:
    """Header + items for a quotation's job card. None if the quotation is gone."""
    header = await session.execute(
        text(
            "SELECT q.id, q.quote_no, q.status, q.created_at, q.customer_id,"
            "       c.name AS client_name, c.wa_id, s.name AS dealt_with"
            " FROM quotations q"
            " JOIN customers c ON c.id = q.customer_id"
            " LEFT JOIN salespersons s ON s.id = q.created_by"
            " WHERE q.id = :id"
        ),
        {"id": str(quotation_id)},
    )
    row = header.mappings().first()
    if row is None:
        return None
    items = await _items(session, "quotation_items", "quotation_id", quotation_id)
    return {
        "source": "quotation",
        "customer_id": str(row["customer_id"]),
        "wa_id": row["wa_id"],
        "header": {
            "doc_label": "JOB CARD",
            "doc_no": row["quote_no"],
            "client_name": row["client_name"],
            "order_date": row["created_at"],
            # A quotation has no committed delivery date — the template prints an
            # em dash rather than inventing one.
            "delivery_date": None,
            "dealt_with": row["dealt_with"],
            "status": row["status"],
        },
        "items": await resolve_photo_keys(session, "quotation", items),
    }


async def order_job_card(session: AsyncSession, order_id: UUID) -> dict | None:
    """Header + items for an order's job card. None if the order is gone."""
    header = await session.execute(
        text(
            "SELECT o.id, o.order_no, o.status, o.created_at, o.expected_delivery_date,"
            "       o.customer_id, c.name AS client_name, c.wa_id, s.name AS dealt_with"
            " FROM orders o"
            " JOIN customers c ON c.id = o.customer_id"
            " LEFT JOIN salespersons s ON s.id = o.salesperson_id"
            " WHERE o.id = :id"
        ),
        {"id": str(order_id)},
    )
    row = header.mappings().first()
    if row is None:
        return None
    items = await _items(session, "order_items", "order_id", order_id)
    return {
        "source": "order",
        "customer_id": str(row["customer_id"]),
        "wa_id": row["wa_id"],
        "header": {
            "doc_label": "JOB CARD",
            "doc_no": row["order_no"],
            "client_name": row["client_name"],
            "order_date": row["created_at"],
            "delivery_date": row["expected_delivery_date"],
            "dealt_with": row["dealt_with"],
            "status": row["status"],
        },
        "items": await resolve_photo_keys(session, "order", items),
    }


async def workshop_recipients(session: AsyncSession, order_id: UUID) -> list[dict]:
    """Distinct active workshops holding items of this order, with a phone to send
    to. A workshop with no phone is returned with phone=None so the caller can tell
    the user WHICH workshop it could not reach instead of silently sending nothing.
    """
    result = await session.execute(
        text(
            "SELECT DISTINCT w.id, w.name, w.manager_phone, w.manager_name"
            " FROM order_items oi"
            " JOIN workshops w ON w.id = oi.workshop_id"
            " WHERE oi.order_id = :oid AND w.active = true"
            " ORDER BY w.name"
        ),
        {"oid": str(order_id)},
    )
    return [dict(m) for m in result.mappings().all()]
