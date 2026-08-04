"""Deliveries and their consignments — the reads the challan needs (0040).

A delivery is a LORRY RUN carrying items from any number of orders, for any number of
customers. A CONSIGNMENT is one recipient's share of that run: `(delivery, customer)`, and
therefore exactly one challan.

Everything here is service-role (the Celery worker and the documents router run on the
direct DB connection, not an RLS-limited role) — the caller is responsible for the
authorization check. `api/documents.py` does that per consignment, which is cheap because a
consignment has exactly one customer by construction.

There is no `deliveries` write path here on purpose: runs are created by the
`schedule_delivery(jsonb)` function under the caller's own authorization (0040 §3), and the
driver's completion is a single scoped UPDATE from the PWA. Adding a service-role write
would be a second, unaudited way to move goods.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def consignment_or_none(session: AsyncSession, consignment_id: UUID) -> dict | None:
    """The identity + authorization facts for one consignment.

    `customer_id` is the whole reason the consignment grain exists: the caller can be
    checked against ONE customer instead of every customer on the lorry.
    """
    result = await session.execute(
        text(
            "SELECT dc.id, dc.delivery_id, dc.customer_id, dc.challan_no,"
            "       d.status, d.scheduled_date"
            "  FROM delivery_consignments dc"
            "  JOIN deliveries d ON d.id = dc.delivery_id"
            " WHERE dc.id = :id"
        ),
        {"id": str(consignment_id)},
    )
    found = result.mappings().first()
    return None if found is None else dict(found)


async def consignments_for_delivery(session: AsyncSession, delivery_id: UUID) -> list[dict]:
    """Every recipient on one run, with their challan number if it has been allocated.

    The dashboard renders one "Generate challan" control per row of this: a mixed-customer
    run produces one document per customer, never one document listing both.
    """
    result = await session.execute(
        text(
            "SELECT dc.id, dc.customer_id, dc.challan_no, dc.delivery_address,"
            "       dc.delivery_rent, dc.dp_code, c.name AS customer_name,"
            "       count(di.id)::int AS item_count"
            "  FROM delivery_consignments dc"
            "  JOIN customers c ON c.id = dc.customer_id"
            "  LEFT JOIN delivery_items di ON di.consignment_id = dc.id"
            " WHERE dc.delivery_id = :id"
            " GROUP BY dc.id, c.name"
            " ORDER BY c.name"
        ),
        {"id": str(delivery_id)},
    )
    return [dict(row) for row in result.mappings().all()]


async def claim_challan_no(
    session: AsyncSession, consignment_id: UUID, challan_no: str
) -> str | None:
    """Write the challan number iff this consignment has none, and return what it now has.

    Guarded by `challan_no IS NULL` and returning the row, so two concurrent "Generate
    challan" taps cannot produce two numbers for one consignment — the loser reads back the
    winner's. Returns None only if the consignment vanished.
    """
    claimed = await session.execute(
        text(
            "UPDATE delivery_consignments SET challan_no = :no, updated_at = now()"
            " WHERE id = :id AND challan_no IS NULL RETURNING challan_no"
        ),
        {"no": challan_no, "id": str(consignment_id)},
    )
    won = claimed.first()
    if won is not None:
        return str(won[0])

    reread = await session.execute(
        text("SELECT challan_no FROM delivery_consignments WHERE id = :id"),
        {"id": str(consignment_id)},
    )
    again = reread.first()
    return str(again[0]) if again and again[0] else None


async def challan_head(session: AsyncSession, consignment_id: UUID) -> dict | None:
    """The header block of one consignment's challan.

    ─── WHY THE BALANCE IS SUMMED OVER SEVERAL ORDERS ────────────────────────────
    Their "Balance Amount" is what the driver may collect from THIS customer today. When
    one signature covers pieces off two of that customer's orders, the figure they are
    being asked about is both orders' outstanding — quoting one order's balance on paper
    covering both would understate what is owed, on the one document the driver collects
    against. So the sum is over the DISTINCT orders this consignment actually carries, and
    it is computed live, never stored: a stale figure on the paperwork is worse than none.

    Refunds are negative payments, so a plain SUM is correct (mirrors order_outstanding).
    """
    result = await session.execute(
        text(
            "WITH consignment_orders AS ("
            "    SELECT DISTINCT di.order_id"
            "      FROM delivery_items di"
            "     WHERE di.consignment_id = :id"
            ")"
            " SELECT dc.id, dc.challan_no, dc.delivery_address, dc.delivery_rent,"
            "        dc.dp_code, dc.delivery_id,"
            "        d.scheduled_date, d.vehicle_no, d.notes,"
            "        c.name AS customer_name, c.phone AS customer_phone,"
            "        sp.name AS driver_name, sp.whatsapp AS driver_phone,"
            "        ("
            "          SELECT coalesce(sum("
            "                     o.grand_total - coalesce("
            "                         (SELECT sum(p.amount) FROM payments p"
            "                           WHERE p.order_id = o.id), 0)"
            "                 ), 0)"
            "            FROM orders o"
            "           WHERE o.id IN (SELECT order_id FROM consignment_orders)"
            "        ) AS balance_due"
            "   FROM delivery_consignments dc"
            "   JOIN deliveries d ON d.id = dc.delivery_id"
            "   JOIN customers c ON c.id = dc.customer_id"
            "   LEFT JOIN salespersons sp ON sp.id = d.driver_salesperson_id"
            "  WHERE dc.id = :id"
        ),
        {"id": str(consignment_id)},
    )
    found = result.mappings().first()
    return None if found is None else dict(found)


async def challan_lines(session: AsyncSession, consignment_id: UUID) -> list[dict]:
    """The goods on this challan: one tick-box row per piece, with its order number.

    Ordered by order then line so a mixed-order challan reads as blocks per order rather
    than an interleaved list the customer has to sort out at their front door.
    """
    result = await session.execute(
        text(
            "SELECT oi.description, oi.qty, o.order_no"
            "  FROM delivery_items di"
            "  JOIN order_items oi ON oi.id = di.order_item_id"
            "  JOIN orders o ON o.id = di.order_id"
            " WHERE di.consignment_id = :id"
            " ORDER BY o.created_at, o.order_no, oi.sort"
        ),
        {"id": str(consignment_id)},
    )
    return [dict(row) for row in result.mappings().all()]
