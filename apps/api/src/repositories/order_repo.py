"""Order repository — orders + order_items reads/writes.

Raw SQL on an AsyncSession; caller owns the transaction. Totals are supplied
pre-computed (gst.py) — this layer never trusts/recomputes money. Money binds as
Decimal, dates as native date, uuids as strings (PLAN.md decisions 1-3).
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..services.gst import DocTotals


@dataclass(frozen=True)
class OrderItem:
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


async def _insert_items(session: AsyncSession, order_id: UUID, items: list[OrderItem]) -> None:
    for i, it in enumerate(items):
        await session.execute(
            text(
                "INSERT INTO order_items (order_id, product_id, description, dimensions, material,"
                " fabric, polish, customization, qty, unit, unit_price, hsn, gst_rate, line_total, sort)"
                " VALUES (:oid, :product_id, :description, :dimensions, :material, :fabric, :polish,"
                " :customization, :qty, :unit, :unit_price, :hsn, :gst_rate, :line_total, :sort)"
            ),
            {
                "oid": str(order_id),
                "product_id": str(it.product_id) if it.product_id else None,
                "description": it.description, "dimensions": it.dimensions,
                "material": it.material, "fabric": it.fabric, "polish": it.polish,
                "customization": it.customization, "qty": it.qty, "unit": it.unit,
                "unit_price": it.unit_price, "hsn": it.hsn, "gst_rate": it.gst_rate,
                "line_total": it.line_total, "sort": it.sort if it.sort else i,
            },
        )


async def _insert_order(
    session: AsyncSession, *, order_no: str, customer_id: str, quotation_id: str | None,
    totals: DocTotals, advance_expected: Decimal, salesperson_id: str | None,
    expected_delivery_date: date | None, notes: str | None,
) -> UUID:
    row = await session.execute(
        text(
            "INSERT INTO orders (order_no, customer_id, quotation_id, status, expected_delivery_date,"
            " advance_expected, subtotal, discount_amount, taxable_value, cgst, sgst, igst,"
            " grand_total, salesperson_id, notes)"
            " VALUES (:order_no, :customer_id, :quotation_id, 'confirmed', :edd, :advance,"
            " :subtotal, :discount, :taxable, :cgst, :sgst, :igst, :grand, :sp, :notes)"
            " RETURNING id"
        ),
        {
            "order_no": order_no, "customer_id": customer_id, "quotation_id": quotation_id,
            "edd": expected_delivery_date, "advance": advance_expected,
            "subtotal": totals.subtotal, "discount": totals.discount_amount,
            "taxable": totals.taxable_value, "cgst": totals.cgst, "sgst": totals.sgst,
            "igst": totals.igst, "grand": totals.grand_total, "sp": salesperson_id, "notes": notes,
        },
    )
    return row.scalar_one()


async def create_order(
    session: AsyncSession, *, order_no: str, customer_id: UUID, totals: DocTotals,
    items: list[OrderItem], advance_expected: Decimal = Decimal(0),
    salesperson_id: UUID | None = None, quotation_id: UUID | None = None,
    expected_delivery_date: date | None = None, notes: str | None = None,
) -> UUID:
    """Insert a confirmed order + its items. Returns the id."""
    order_id = await _insert_order(
        session, order_no=order_no, customer_id=str(customer_id),
        quotation_id=str(quotation_id) if quotation_id else None, totals=totals,
        advance_expected=advance_expected,
        salesperson_id=str(salesperson_id) if salesperson_id else None,
        expected_delivery_date=expected_delivery_date, notes=notes,
    )
    await _insert_items(session, order_id, items)
    return order_id


async def create_from_quote(
    session: AsyncSession, quotation_id: UUID, *, order_no: str, advance_pct: int = 50,
    salesperson_id: UUID | None = None,
) -> UUID | None:
    """Copy an APPROVED quotation into a new confirmed order (header totals +
    items copied verbatim). advance_expected = grand_total * advance_pct%,
    rounded half-up. None if the quote is missing or not approved.

    Idempotent: if an order already exists for this quotation it is returned as-is
    rather than creating a duplicate. This makes client retries (e.g. after a
    network/timeout on a slow first request) safe — one quote yields one order.
    A partial unique index on orders(quotation_id) (migration 0022) is the DB-level
    backstop for the concurrent-request race this check can't cover alone."""
    from decimal import ROUND_HALF_UP

    existing = await session.execute(
        text("SELECT id FROM orders WHERE quotation_id = :id ORDER BY created_at LIMIT 1"),
        {"id": str(quotation_id)},
    )
    existing_row = existing.first()
    if existing_row is not None:
        return existing_row[0]

    q = await session.execute(
        text("SELECT * FROM quotations WHERE id = :id"), {"id": str(quotation_id)}
    )
    quote = q.mappings().first()
    if quote is None or quote["status"] != "approved":
        return None

    advance_expected = (
        Decimal(str(quote["grand_total"])) * Decimal(advance_pct) / Decimal(100)
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    order_id = await _insert_order(
        session, order_no=order_no, customer_id=str(quote["customer_id"]),
        quotation_id=str(quotation_id),
        totals=DocTotals(
            subtotal=quote["subtotal"], discount_amount=quote["discount_amount"],
            taxable_value=quote["taxable_value"], cgst=quote["cgst"], sgst=quote["sgst"],
            igst=quote["igst"], grand_total=quote["grand_total"],
        ),
        advance_expected=advance_expected,
        salesperson_id=str(salesperson_id) if salesperson_id else (
            str(quote["created_by"]) if quote["created_by"] else None
        ),
        expected_delivery_date=None, notes=None,
    )
    src_items = await session.execute(
        text("SELECT * FROM quotation_items WHERE quotation_id = :id ORDER BY sort, id"),
        {"id": str(quotation_id)},
    )
    items = [
        OrderItem(
            description=it["description"], qty=it["qty"], unit_price=it["unit_price"],
            hsn=it["hsn"], gst_rate=it["gst_rate"], line_total=it["line_total"],
            product_id=it["product_id"], dimensions=it["dimensions"], material=it["material"],
            fabric=it["fabric"], polish=it["polish"], customization=it["customization"],
            unit=it["unit"], sort=it["sort"],
        )
        for it in src_items.mappings().all()
    ]
    await _insert_items(session, order_id, items)
    return order_id


async def get_order(session: AsyncSession, order_id: UUID) -> dict | None:
    header = await session.execute(text("SELECT * FROM orders WHERE id = :id"), {"id": str(order_id)})
    row = header.mappings().first()
    if row is None:
        return None
    items = await session.execute(
        text("SELECT * FROM order_items WHERE order_id = :id ORDER BY sort, id"), {"id": str(order_id)}
    )
    result = dict(row)
    result["items"] = [dict(m) for m in items.mappings().all()]
    return result


async def get_status(session: AsyncSession, order_id: UUID) -> str | None:
    result = await session.execute(text("SELECT status FROM orders WHERE id = :id"), {"id": str(order_id)})
    row = result.first()
    return row[0] if row else None


async def order_customer_id(session: AsyncSession, order_id: UUID) -> str | None:
    result = await session.execute(text("SELECT customer_id FROM orders WHERE id = :id"), {"id": str(order_id)})
    row = result.first()
    return str(row[0]) if row else None


async def set_status(
    session: AsyncSession, order_id: UUID, *, from_status: str, to_status: str, reason: str | None = None
) -> bool:
    """Apply a pre-validated transition (optimistic on from_status). False if the
    row no longer matches from_status (lost race). A reason is written to the
    audit log when supplied (the status trigger logs the transition itself)."""
    updated = await session.execute(
        text("UPDATE orders SET status = :to WHERE id = :id AND status = :frm RETURNING id"),
        {"to": to_status, "id": str(order_id), "frm": from_status},
    )
    if updated.first() is None:
        return False
    if reason:
        await session.execute(
            text(
                "INSERT INTO audit_log (entity, entity_id, action, payload)"
                " VALUES ('orders', :id, :action, cast(:payload AS jsonb))"
            ),
            {"id": str(order_id), "action": f"reason:{to_status}",
             "payload": f'{{"reason": {_json_str(reason)}}}'},
        )
    return True


async def patch_order(
    session: AsyncSession, order_id: UUID, *, expected_delivery_date: date | None, notes: str | None
) -> bool:
    """Update the two mutable non-status fields. False if the order doesn't exist."""
    result = await session.execute(
        text(
            "UPDATE orders SET expected_delivery_date = :edd, notes = :notes"
            " WHERE id = :id RETURNING id"
        ),
        {"edd": expected_delivery_date, "notes": notes, "id": str(order_id)},
    )
    return result.first() is not None


def _json_str(value: str) -> str:
    """Minimal JSON string escaping for the audit payload literal."""
    import json
    return json.dumps(value)
