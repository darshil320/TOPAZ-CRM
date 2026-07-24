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
    unit: str | None = None
    sort: int = 0


async def _insert_items(session: AsyncSession, quotation_id: UUID, items: list[QuoteItem]) -> None:
    for i, it in enumerate(items):
        await session.execute(
            text(
                "INSERT INTO quotation_items (quotation_id, product_id, description, dimensions,"
                " material, fabric, polish, customization, qty, unit, unit_price, hsn, gst_rate,"
                " line_total, sort)"
                " VALUES (:qid, :product_id, :description, :dimensions, :material, :fabric, :polish,"
                " :customization, :qty, :unit, :unit_price, :hsn, :gst_rate, :line_total, :sort)"
            ),
            {
                "qid": str(quotation_id),
                "product_id": str(it.product_id) if it.product_id else None,
                "description": it.description,
                "dimensions": it.dimensions,
                "material": it.material,
                "fabric": it.fabric,
                "polish": it.polish,
                "customization": it.customization,
                "qty": it.qty,
                "unit": it.unit,
                "unit_price": it.unit_price,
                "hsn": it.hsn,
                "gst_rate": it.gst_rate,
                "line_total": it.line_total,
                "sort": it.sort if it.sort else i,
            },
        )


async def create_quotation(
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
) -> UUID:
    """Insert a draft quotation + its items in the caller's transaction. Returns the id."""
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
    quotation_id = row.scalar_one()
    await _insert_items(session, quotation_id, items)
    return quotation_id


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


async def get_status(session: AsyncSession, quotation_id: UUID) -> str | None:
    result = await session.execute(
        text("SELECT status FROM quotations WHERE id = :id"), {"id": str(quotation_id)}
    )
    row = result.first()
    return row[0] if row else None
