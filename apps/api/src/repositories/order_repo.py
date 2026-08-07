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


_ITEM_COLUMNS = (
    "order_id", "product_id", "description", "dimensions", "material", "fabric",
    "polish", "customization", "qty", "unit", "unit_price", "hsn", "gst_rate",
    "line_total", "sort",
)


async def _insert_items(session: AsyncSession, order_id: UUID, items: list[OrderItem]) -> None:
    """Insert every line in ONE statement — see quotation_repo._insert_items for why.

    This one also carries confirming an order from a quote, which copies the whole
    line set, so it paid a round-trip per line at the exact moment the salesperson is
    stood in front of the customer waiting for the order number.
    """
    if not items:
        return
    rows = [
        {
            "order_id": str(order_id),
            "product_id": str(it.product_id) if it.product_id else None,
            "description": it.description, "dimensions": it.dimensions,
            "material": it.material, "fabric": it.fabric, "polish": it.polish,
            "customization": it.customization, "qty": it.qty, "unit": it.unit,
            "unit_price": it.unit_price, "hsn": it.hsn, "gst_rate": it.gst_rate,
            "line_total": it.line_total, "sort": it.sort if it.sort else i,
        }
        for i, it in enumerate(items)
    ]
    placeholders = ", ".join(
        "(" + ", ".join(f":{col}_{i}" for col in _ITEM_COLUMNS) + ")"
        for i in range(len(rows))
    )
    params = {f"{col}_{i}": row[col] for i, row in enumerate(rows) for col in _ITEM_COLUMNS}
    await session.execute(
        text(f"INSERT INTO order_items ({', '.join(_ITEM_COLUMNS)}) VALUES {placeholders}"),
        params,
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


async def cancellation_state(session: AsyncSession, order_id: UUID) -> dict:
    """What stands in the way of cancelling this order, and what it will cost.

    ONE query, because every field here is needed to answer "may I cancel?" and a
    per-check round-trip would put four of them in front of a button tap.

    Two of these are BLOCKERS and two are DISCLOSURES, and the difference matters:

      * `in_transit_items` — goods are physically on a lorry between workshops. There
        is no honest way to cancel an order whose custody is mid-handover; the
        transfer has to be received or cancelled first, which is a real action
        somebody must take.
      * `open_delivery_items` — the goods are loaded on a run that has not completed.
        Unschedule it first, for the same reason.
      * `paid` — money already taken. NOT a blocker: a showroom cancels and refunds
        afterwards, and payments are immutable by trigger (0016), so cancelling can
        never quietly erase a receipt. It is returned so the caller can say a refund
        is owed instead of the operator discovering it later.
      * `delivered_items` — pieces already handed over. Also not a blocker (the rest
        of the order may still be cancelled) but it changes what cancelling means, so
        the number is surfaced.
    """
    result = await session.execute(
        text(
            "SELECT o.status,"
            "       o.grand_total,"
            "       (SELECT count(*) FROM order_items i"
            "         WHERE i.order_id = o.id AND i.transit_transfer_id IS NOT NULL)"
            "         AS in_transit_items,"
            "       (SELECT count(*) FROM delivery_items di"
            "         JOIN deliveries d ON d.id = di.delivery_id"
            "         WHERE di.order_id = o.id"
            "           AND d.status NOT IN ('delivered', 'failed')) AS open_delivery_items,"
            "       (SELECT count(*) FROM order_items i"
            "         WHERE i.order_id = o.id AND i.delivered_at IS NOT NULL)"
            "         AS delivered_items,"
            "       (SELECT count(*) FROM order_items i WHERE i.order_id = o.id) AS total_items,"
            "       coalesce((SELECT sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END)"
            "                  FROM payments p WHERE p.order_id = o.id), 0) AS paid"
            " FROM orders o WHERE o.id = :id"
        ),
        {"id": str(order_id)},
    )
    row = result.mappings().first()
    return {} if row is None else dict(row)


async def cancel_open_production(session: AsyncSession, order_id: UUID) -> dict:
    """Stand down the production machinery for a cancelled order.

    Called INSIDE the cancelling transaction, so an order can never be left cancelled
    while its workshops are still being chased for it.

    Three things stop, and each would otherwise keep running against an order nobody
    is building any more:

      * open route legs → 'cancelled'. Same treatment `route_repo.cancel_open_legs`
        gives a re-planned route: legs are cancelled, never deleted, because an
        `active` leg is a record of goods having physically been somewhere.
      * active workshop assignments → inactive, so the item stops counting towards a
        workshop's `open_item_count` and leaves its queue.
      * unfinished stage-plan rows → `skipped`, which is what takes them out of
        `due_reminders` (0035). Without this the workshop keeps getting WhatsApp
        reminders for a cancelled piece — the most visible way this bug would show.

    Rows already `done`/`received` are untouched: they are history, not work.
    """
    legs = await session.execute(
        text(
            "UPDATE order_item_route_legs SET status = 'cancelled'"
            " WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = :order)"
            "   AND status IN ('pending', 'in_transit', 'active')"
        ),
        {"order": str(order_id)},
    )
    assignments = await session.execute(
        text(
            "UPDATE order_item_assignments SET active = false"
            " WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = :order)"
            "   AND active = true"
        ),
        {"order": str(order_id)},
    )
    plans = await session.execute(
        text(
            # `planned_days` and `due_at` MUST be cleared alongside the flag:
            # stage_plan_skip_consistency (0035) rejects a skipped row that still
            # carries either, on the grounds that a skipped stage with a deadline is a
            # contradiction. Clearing due_at is also what actually silences the
            # reminder scan, which keys on it.
            "UPDATE order_item_stage_plan"
            "   SET skipped = true, planned_days = NULL, due_at = NULL"
            " WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = :order)"
            "   AND skipped = false"
            "   AND NOT EXISTS (SELECT 1 FROM production_events e"
            "                    WHERE e.order_item_id = order_item_stage_plan.order_item_id"
            "                      AND e.stage_code = order_item_stage_plan.stage_code"
            "                      AND e.kind = 'done')"
        ),
        {"order": str(order_id)},
    )
    return {
        "legs_cancelled": int(legs.rowcount or 0),
        "assignments_closed": int(assignments.rowcount or 0),
        "stage_plans_skipped": int(plans.rowcount or 0),
    }


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
