/**
 * Row shapes for the dispatch board.
 *
 * ─── A RUN NO LONGER HAS "AN ORDER" (0040) ───────────────────────────────────
 * A delivery carries items from any number of orders, for any number of customers, so
 * `DeliveryRow` has no `order_id` and no single `orders` embed. The orders and the
 * recipients are DERIVED from the run's lines — `ordersOf()` / `recipientsOf()` are the one
 * place that derivation lives, so no component re-implements it.
 *
 * PostgREST types an embedded relation as either an object or an array depending on how it
 * inferred the FK, and the previous version papered over that with `any[]` on every prop.
 * The `…Of` helpers below are the one place that ambiguity is resolved, so no component
 * repeats `Array.isArray(x) ? x[0] : x` five times.
 */

export interface CustomerRef {
  id?: string | null;
  name: string | null;
  phone?: string | null;
}

export interface OrderRef {
  id?: string | null;
  order_no: string | null;
  status?: string | null;
  fulfillment_status?: string | null;
  customers?: CustomerRef | CustomerRef[] | null;
}

export interface StaffRef {
  name: string | null;
}

/** One order line, as the delivery board needs it (0039). */
export interface OrderItemRef {
  id: string;
  description: string | null;
  qty: number | null;
  unit: string | null;
  /** Null until the item clears its last production stage. */
  production_done_at?: string | null;
  /** Set once the item physically went out on a completed run. */
  delivered_at?: string | null;
  current_stage?: string | null;
  workshops?: { name: string | null } | { name: string | null }[] | null;
  /** The parent order, embedded on a DELIVERY's lines so the board can name it (0040). */
  orders?: OrderRef | OrderRef[] | null;
}

/** A line ON a delivery — the goods that travel on this particular run. */
export interface DeliveryItemRow {
  order_item_id: string;
  /** Denormalised on the row itself (0040) — no join needed to group by order. */
  order_id?: string | null;
  customer_id?: string | null;
  consignment_id?: string | null;
  received?: boolean | null;
  order_items?: OrderItemRef | OrderItemRef[] | null;
}

/** One recipient's share of a run: exactly one challan (0040). */
export interface ConsignmentRow {
  id: string;
  customer_id: string;
  challan_no?: string | null;
  delivery_address?: string | null;
  customers?: CustomerRef | CustomerRef[] | null;
}

export interface DeliveryRow {
  id: string;
  status: string;
  scheduled_date: string;
  delivered_at: string | null;
  vehicle_no: string | null;
  eway_bill_no: string | null;
  notes: string | null;
  salespersons?: StaffRef | StaffRef[] | null;
  delivery_items?: DeliveryItemRow[] | null;
  delivery_consignments?: ConsignmentRow[] | null;
}

export interface ReadyOrderRow {
  id: string;
  order_no: string;
  status: string;
  /** not_delivered | partially_delivered | fully_delivered (0040). */
  fulfillment_status?: string | null;
  customers?: CustomerRef | CustomerRef[] | null;
  /** Every line of the order, so the picker can show what is and is not deliverable. */
  order_items?: OrderItemRef[] | null;
}

export interface StaffRow {
  id: string;
  name: string;
  role: string | null;
}

/** A picked line, carrying enough context to group the basket by order and customer. */
export interface BasketLine {
  itemId: string;
  orderId: string;
  orderNo: string;
  customerId: string;
  customerName: string;
  description: string;
  qty: number | null;
  unit: string | null;
}

/** The challan fields a manager fills in per recipient before confirming a run. */
export interface ConsignmentDraft {
  customerId: string;
  customerName: string;
  deliveryAddress: string;
  deliveryRent: string;
  dpCode: string;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function customerOf(row: OrderRef | ReadyOrderRow | ConsignmentRow | null): CustomerRef | null {
  return row ? first(row.customers) : null;
}

export function driverOf(row: DeliveryRow): StaffRef | null {
  return first(row.salespersons);
}

/** The order lines travelling on this run, flattened past PostgREST's shape ambiguity. */
export function itemsOf(row: DeliveryRow): OrderItemRef[] {
  return (row.delivery_items ?? [])
    .map((line) => first(line.order_items))
    .filter((item): item is OrderItemRef => item !== null);
}

/**
 * The distinct orders on this run, in the order their first line appears.
 *
 * Replaces the old `orderOf(row)`: a run can span several orders, and the board must name
 * all of them — a row showing only the first would be indistinguishable from a
 * single-order run and would hide goods a manager is accountable for.
 */
export function ordersOf(row: DeliveryRow): OrderRef[] {
  const seen = new Map<string, OrderRef>();
  for (const line of row.delivery_items ?? []) {
    const order = first(first(line.order_items)?.orders ?? null);
    if (!order) continue;
    const key = order.id ?? order.order_no ?? "";
    if (key && !seen.has(key)) seen.set(key, order);
  }
  return [...seen.values()];
}

/**
 * The recipients of this run, preferring the consignment rows.
 *
 * Consignments are the authoritative recipient list — they exist precisely so a run knows
 * who signs for what. The item-derived fallback covers a query that did not embed them and
 * pre-0040 rows.
 */
export function recipientsOf(row: DeliveryRow): CustomerRef[] {
  const fromConsignments: CustomerRef[] = [];
  for (const consignment of row.delivery_consignments ?? []) {
    const customer = customerOf(consignment);
    if (customer) fromConsignments.push({ ...customer, id: consignment.customer_id });
  }
  if (fromConsignments.length > 0) return fromConsignments;

  const seen = new Map<string, CustomerRef>();
  for (const order of ordersOf(row)) {
    const customer = customerOf(order);
    const key = customer?.name ?? "";
    if (customer && key && !seen.has(key)) seen.set(key, customer);
  }
  return [...seen.values()];
}

export function workshopOf(item: OrderItemRef): string | null {
  return first(item.workshops)?.name ?? null;
}

/**
 * Why this item cannot go out yet — null when it can.
 *
 * Rendered next to a DISABLED checkbox rather than used to hide the row: the manager
 * choosing what to load needs to know why a piece is missing from the run, and a silently
 * absent line looks like a data bug. The rules mirror the DB's own
 * (`delivery_items_one_open`, 0039) so the greyed reason and the eventual error agree.
 */
export function ineligibleReason(
  item: OrderItemRef,
  openItemIds: Set<string>,
): string | null {
  if (item.delivered_at) return "Already delivered";
  if (openItemIds.has(item.id)) return "On another open delivery";
  if (!item.production_done_at) {
    const workshop = workshopOf(item);
    const stage = item.current_stage?.replaceAll("_", " ");
    if (stage && workshop) return `Still in ${stage} at ${workshop}`;
    if (stage) return `Still in ${stage}`;
    return "Production not finished";
  }
  return null;
}

/** Not delivered / part-shipped / done — the chip the board and the order list show. */
export function fulfillmentLabel(status: string | null | undefined): {
  label: string;
  tone: "pos" | "warn" | "neutral";
} {
  switch (status) {
    case "fully_delivered":
      return { label: "Fully delivered", tone: "pos" };
    case "partially_delivered":
      return { label: "Partly delivered", tone: "warn" };
    default:
      return { label: "Not delivered", tone: "neutral" };
  }
}
