"""Quotation repository — quotations + quotation_items reads/writes.

Raw SQL via sqlalchemy.text() on an AsyncSession; the caller owns the transaction
(commit/rollback). Totals are always supplied pre-computed by the router (gst.py) —
this layer never trusts or recomputes money. Money binds as Decimal, dates as native
date objects, uuids as strings (PLAN.md decisions 1–3).
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..services.gst import DocTotals


@dataclass(frozen=True)
class QuoteItem:
    description: str
    qty: Decimal
    unit_price: Decimal
    hsn: str
    gst_rate: Decimal
    line_total: Decimal
    product_id: UUID | None = None
    dimensions: str | None = None
    material: str | None = None
    fabric: str | None = None
    polish: str | None = None
    customization: str | None = None
    spec_notes: str | None = None
    unit: str | None = None
    sort: int = 0


_ITEM_COLUMNS = (
    "quotation_id", "product_id", "description", "dimensions", "material", "fabric",
    "polish", "customization", "spec_notes", "qty", "unit", "unit_price", "hsn",
    "gst_rate", "line_total", "sort",
)


def _item_params(quotation_id: UUID, items: list[QuoteItem]) -> list[dict]:
    """One bind-parameter dict per line, in insert order."""
    return [
        {
            "quotation_id": str(quotation_id),
            "product_id": str(it.product_id) if it.product_id else None,
            "description": it.description,
            "dimensions": it.dimensions,
            "material": it.material,
            "fabric": it.fabric,
            "polish": it.polish,
            "customization": it.customization,
            "spec_notes": it.spec_notes,
            "qty": it.qty,
            "unit": it.unit,
            "unit_price": it.unit_price,
            "hsn": it.hsn,
            "gst_rate": it.gst_rate,
            "line_total": it.line_total,
            # `sort` is 0-based, so a falsy 0 must NOT fall back to the index — they
            # happen to agree for the first line, which is why the old `it.sort if
            # it.sort else i` looked correct. Position is the real intent.
            "sort": it.sort if it.sort else i,
        }
        for i, it in enumerate(items)
    ]


async def _insert_items(
    session: AsyncSession, quotation_id: UUID, items: list[QuoteItem]
) -> list[dict]:
    """Insert every line in ONE statement. Returns the inserted rows, in sort order.

    This was a loop doing one INSERT per line, i.e. one network round-trip per line.
    On a local socket that is invisible; against Supabase's pooler it is the whole
    cost of creating a quotation — a 40-line quote paid 44 sequential round-trips,
    and a showroom quote is routinely 10-20 lines. Executed as a single multi-row
    INSERT it is one.

    `RETURNING *` so a caller that must answer with the created record does not have
    to SELECT back rows this statement just wrote — including the ids and defaults
    only the database can supply, which is why the rows are returned rather than
    reconstructed in Python.

    Bound parameters, one set per row — no SQL is built from item data.
    """
    if not items:
        return []
    rows = _item_params(quotation_id, items)
    placeholders = ", ".join(
        "(" + ", ".join(f":{col}_{i}" for col in _ITEM_COLUMNS) + ")"
        for i in range(len(rows))
    )
    params = {f"{col}_{i}": row[col] for i, row in enumerate(rows) for col in _ITEM_COLUMNS}
    result = await session.execute(
        text(
            f"INSERT INTO quotation_items ({', '.join(_ITEM_COLUMNS)})"
            f" VALUES {placeholders} RETURNING *"
        ),
        params,
    )
    # INSERT ... RETURNING has no defined row order; the read path orders by
    # (sort, id), so match it here rather than trusting insertion order.
    return sorted((dict(m) for m in result.mappings().all()),
                  key=lambda r: (r["sort"], str(r["id"])))


async def _create(
    session: AsyncSession,
    *,
    quote_no: str,
    customer_id: UUID,
    totals: DocTotals,
    items: list[QuoteItem],
    place_of_supply: str = "GJ",
    valid_until: date | None = None,
    terms: str | None = None,
    notes: str | None = None,
    created_by: UUID | None = None,
    revision_of: UUID | None = None,
    revision_no: int = 1,
) -> tuple[dict, list[dict]]:
    """Insert a draft quotation + its items in the caller's transaction.

    Returns (header_row, item_rows) — two statements, both RETURNING, so neither
    public wrapper has to read anything back.
    """
    row = await session.execute(
        text(
            "INSERT INTO quotations (quote_no, customer_id, status, revision_of, revision_no,"
            " valid_until, place_of_supply, subtotal, discount_amount, taxable_value, cgst, sgst,"
            " igst, grand_total, terms, notes, created_by)"
            " VALUES (:quote_no, :customer_id, 'draft', :revision_of, :revision_no, :valid_until,"
            " :place_of_supply, :subtotal, :discount, :taxable, :cgst, :sgst, :igst, :grand,"
            " :terms, :notes, :created_by)"
            # The whole row, not just the id: the caller returns the created quotation
            # to the dashboard, and re-SELECTing what we just wrote is another
            # round-trip for data Postgres already has in hand.
            " RETURNING *"
        ),
        {
            "quote_no": quote_no,
            "customer_id": str(customer_id),
            "revision_of": str(revision_of) if revision_of else None,
            "revision_no": revision_no,
            "valid_until": valid_until,
            "place_of_supply": place_of_supply,
            "subtotal": totals.subtotal,
            "discount": totals.discount_amount,
            "taxable": totals.taxable_value,
            "cgst": totals.cgst,
            "sgst": totals.sgst,
            "igst": totals.igst,
            "grand": totals.grand_total,
            "terms": terms,
            "notes": notes,
            "created_by": str(created_by) if created_by else None,
        },
    )
    header = dict(row.mappings().one())
    item_rows = await _insert_items(session, header["id"], items)
    return header, item_rows


async def create_quotation_returning(session: AsyncSession, **kwargs) -> dict:
    """Create a quotation and return the full record, in TWO statements.

    The router has to answer with the new quotation, and going back to read it cost
    two further round-trips (header, then items) for rows this very transaction just
    wrote. Both INSERTs now use RETURNING, so the record is assembled from what the
    database already handed back — same shape `get_quotation` produces.
    """
    header, item_rows = await _create(session, **kwargs)
    return {**header, "items": item_rows}


async def create_quotation(session: AsyncSession, **kwargs) -> UUID:
    """Id-only variant, for the callers that do not need the record back."""
    header, _ = await _create(session, **kwargs)
    return header["id"]


async def get_quotation(session: AsyncSession, quotation_id: UUID) -> dict | None:
    """Full quotation header + ordered items, as plain dicts. None if not found."""
    header = await session.execute(
        text("SELECT * FROM quotations WHERE id = :id"), {"id": str(quotation_id)}
    )
    row = header.mappings().first()
    if row is None:
        return None
    items = await session.execute(
        text("SELECT * FROM quotation_items WHERE quotation_id = :id ORDER BY sort, id"),
        {"id": str(quotation_id)},
    )
    result = dict(row)
    result["items"] = [dict(m) for m in items.mappings().all()]
    return result


async def update_draft(
    session: AsyncSession,
    quotation_id: UUID,
    *,
    totals: DocTotals,
    items: list[QuoteItem],
    place_of_supply: str = "GJ",
    valid_until: date | None = None,
    terms: str | None = None,
    notes: str | None = None,
) -> bool:
    """Update a DRAFT quotation's header + replace its items. Returns False (no-op)
    if the quotation is not in draft status — the router turns that into a 409."""
    updated = await session.execute(
        text(
            "UPDATE quotations SET place_of_supply = :place_of_supply, valid_until = :valid_until,"
            " subtotal = :subtotal, discount_amount = :discount, taxable_value = :taxable,"
            " cgst = :cgst, sgst = :sgst, igst = :igst, grand_total = :grand, terms = :terms,"
            " notes = :notes"
            " WHERE id = :id AND status = 'draft'"
            " RETURNING id"
        ),
        {
            "id": str(quotation_id),
            "place_of_supply": place_of_supply,
            "valid_until": valid_until,
            "subtotal": totals.subtotal,
            "discount": totals.discount_amount,
            "taxable": totals.taxable_value,
            "cgst": totals.cgst,
            "sgst": totals.sgst,
            "igst": totals.igst,
            "grand": totals.grand_total,
            "terms": terms,
            "notes": notes,
        },
    )
    if updated.first() is None:
        return False
    await session.execute(
        text("DELETE FROM quotation_items WHERE quotation_id = :id"), {"id": str(quotation_id)}
    )
    await _insert_items(session, quotation_id, items)
    return True


async def soft_delete_draft(session: AsyncSession, quotation_id: UUID) -> bool:
    """Expire a DRAFT quotation (soft delete). False if not draft."""
    result = await session.execute(
        text("UPDATE quotations SET status = 'expired' WHERE id = :id AND status = 'draft' RETURNING id"),
        {"id": str(quotation_id)},
    )
    return result.first() is not None


async def clone_for_revision(
    session: AsyncSession, quotation_id: UUID, *, new_quote_no: str
) -> UUID | None:
    """Clone a quotation into a NEW draft row (revision_of set, revision_no+1) with a
    fresh number and its own approval_token. The source row is untouched. None if the
    source doesn't exist."""
    source = await get_quotation(session, quotation_id)
    if source is None:
        return None
    row = await session.execute(
        text(
            "INSERT INTO quotations (quote_no, customer_id, status, revision_of, revision_no,"
            " valid_until, place_of_supply, subtotal, discount_amount, taxable_value, cgst, sgst,"
            " igst, grand_total, terms, notes, created_by)"
            " VALUES (:quote_no, :customer_id, 'draft', :revision_of, :revision_no, :valid_until,"
            " :place_of_supply, :subtotal, :discount, :taxable, :cgst, :sgst, :igst, :grand,"
            " :terms, :notes, :created_by)"
            " RETURNING id"
        ),
        {
            "quote_no": new_quote_no,
            "customer_id": str(source["customer_id"]),
            "revision_of": str(quotation_id),
            "revision_no": source["revision_no"] + 1,
            "valid_until": source["valid_until"],
            "place_of_supply": source["place_of_supply"],
            "subtotal": source["subtotal"],
            "discount": source["discount_amount"],
            "taxable": source["taxable_value"],
            "cgst": source["cgst"],
            "sgst": source["sgst"],
            "igst": source["igst"],
            "grand": source["grand_total"],
            "terms": source["terms"],
            "notes": source["notes"],
            "created_by": str(source["created_by"]) if source["created_by"] else None,
        },
    )
    new_id = row.scalar_one()
    items = [
        QuoteItem(
            description=it["description"], qty=it["qty"], unit_price=it["unit_price"],
            hsn=it["hsn"], gst_rate=it["gst_rate"], line_total=it["line_total"],
            product_id=it["product_id"], dimensions=it["dimensions"], material=it["material"],
            fabric=it["fabric"], polish=it["polish"], customization=it["customization"],
            unit=it["unit"], sort=it["sort"],
        )
        for it in source["items"]
    ]
    await _insert_items(session, new_id, items)
    return new_id


async def quotation_customer_id(session: AsyncSession, quotation_id: UUID) -> str | None:
    result = await session.execute(
        text("SELECT customer_id FROM quotations WHERE id = :id"), {"id": str(quotation_id)}
    )
    row = result.first()
    return str(row[0]) if row else None


async def get_status(session: AsyncSession, quotation_id: UUID) -> str | None:
    result = await session.execute(
        text("SELECT status FROM quotations WHERE id = :id"), {"id": str(quotation_id)}
    )
    row = result.first()
    return row[0] if row else None


# ─── module 03: send + public approval ──────────────────────────────────────

async def get_send_context(session: AsyncSession, quotation_id: UUID) -> dict | None:
    """Header + customer contact needed to send a quote. None if not found."""
    result = await session.execute(
        text(
            "SELECT q.id, q.quote_no, q.status, q.revision_no, q.pdf_key, q.approval_token,"
            "       q.customer_id, c.name AS customer_name, c.wa_id, c.last_inbound_at"
            " FROM quotations q JOIN customers c ON c.id = q.customer_id"
            " WHERE q.id = :id"
        ),
        {"id": str(quotation_id)},
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def set_pdf_key(session: AsyncSession, quotation_id: UUID, pdf_key: str) -> None:
    await session.execute(
        text("UPDATE quotations SET pdf_key = :k WHERE id = :id"),
        {"k": pdf_key, "id": str(quotation_id)},
    )


async def mark_sent(session: AsyncSession, quotation_id: UUID) -> bool:
    """Advance a draft quotation to 'sent'. False if not currently a draft
    (idempotent: re-sending an already-sent quote is a no-op here)."""
    result = await session.execute(
        text("UPDATE quotations SET status = 'sent' WHERE id = :id AND status = 'draft' RETURNING id"),
        {"id": str(quotation_id)},
    )
    return result.first() is not None


async def get_public_summary(session: AsyncSession, token: UUID) -> dict | None:
    """Customer-facing quote summary by approval_token. None if unknown/expired."""
    header = await session.execute(
        text(
            "SELECT q.id, q.quote_no, q.status, q.revision_no, q.valid_until, q.place_of_supply,"
            "       q.subtotal, q.discount_amount, q.taxable_value, q.cgst, q.sgst, q.igst,"
            "       q.grand_total, q.terms, q.pdf_key, q.customer_id, c.name AS customer_name"
            " FROM quotations q JOIN customers c ON c.id = q.customer_id"
            " WHERE q.approval_token = :t AND q.status <> 'expired'"
        ),
        {"t": str(token)},
    )
    row = header.mappings().first()
    if row is None:
        return None
    items = await session.execute(
        text(
            "SELECT description, dimensions, material, fabric, polish, customization,"
            "       qty, unit, unit_price, hsn, gst_rate, line_total"
            " FROM quotation_items WHERE quotation_id = :id ORDER BY sort, id"
        ),
        {"id": str(row["id"])},
    )
    result = dict(row)
    result["items"] = [dict(m) for m in items.mappings().all()]
    return result


async def mark_viewed(session: AsyncSession, token: UUID) -> None:
    """First customer open: 'sent' → 'viewed'. No-op once past 'sent'."""
    await session.execute(
        text("UPDATE quotations SET status = 'viewed' WHERE approval_token = :t AND status = 'sent'"),
        {"t": str(token)},
    )


async def record_decision(
    session: AsyncSession, token: UUID, *, approve: bool, ip: str | None
) -> dict | None:
    """Idempotently set approved/rejected from a public decision.

    Only transitions from a live state ('sent'/'viewed'); a repeat POST after
    the terminal state is a no-op (returns the row with changed=False). None if
    the token is unknown/expired. approved_at/ip stamped only on the transition.
    """
    ctx = await session.execute(
        text(
            "SELECT id, status, customer_id FROM quotations"
            " WHERE approval_token = :t AND status <> 'expired'"
        ),
        {"t": str(token)},
    )
    row = ctx.mappings().first()
    if row is None:
        return None

    new_status = "approved" if approve else "rejected"
    updated = await session.execute(
        text(
            "UPDATE quotations"
            " SET status = :new, approved_at = now(), approved_ip = :ip"
            " WHERE approval_token = :t AND status IN ('sent', 'viewed')"
            " RETURNING id"
        ),
        {"new": new_status, "ip": ip, "t": str(token)},
    )
    changed = updated.first() is not None
    return {
        "id": str(row["id"]),
        "customer_id": str(row["customer_id"]),
        "status": new_status if changed else row["status"],
        "changed": changed,
    }


async def upsert_pipeline_stage(session: AsyncSession, customer_id: str, stage: str) -> None:
    """Move a customer to a pipeline stage (idempotent upsert on customer_id)."""
    await session.execute(
        text(
            "INSERT INTO pipeline_stages (customer_id, stage) VALUES (:cid, :stage)"
            " ON CONFLICT (customer_id) DO UPDATE SET stage = :stage, updated_at = now()"
        ),
        {"cid": str(customer_id), "stage": stage},
    )
