/**
 * Row shapes for the dispatch board.
 *
 * PostgREST types an embedded relation as either an object or an array
 * depending on how it inferred the FK, and the previous version papered over
 * that with `any[]` on every prop. The `…Of` helpers below are the one place
 * that ambiguity is resolved, so no component repeats
 * `Array.isArray(x) ? x[0] : x` five times.
 */

export interface CustomerRef {
  name: string | null;
  phone?: string | null;
}

export interface OrderRef {
  order_no: string | null;
  status?: string | null;
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
}

/** A line ON a delivery — the goods that travel on this particular run. */
export interface DeliveryItemRow {
  order_item_id: string;
  order_items?: OrderItemRef | OrderItemRef[] | null;
}

export interface DeliveryRow {
  id: string;
  order_id: string;
  status: string;
  scheduled_date: string;
  delivered_at: string | null;
  vehicle_no: string | null;
  eway_bill_no: string | null;
  notes: string | null;
  challan_no?: string | null;
  orders?: OrderRef | OrderRef[] | null;
  salespersons?: StaffRef | StaffRef[] | null;
  delivery_items?: DeliveryItemRow[] | null;
}

export interface ReadyOrderRow {
  id: string;
  order_no: string;
  status: string;
  customers?: CustomerRef | CustomerRef[] | null;
  /** Every line of the order, so the picker can show what is and is not deliverable. */
  order_items?: OrderItemRef[] | null;
}

export interface StaffRow {
  id: string;
  name: string;
  role: string | null;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function orderOf(row: DeliveryRow): OrderRef | null {
  return first(row.orders);
}

export function customerOf(row: OrderRef | ReadyOrderRow | null): CustomerRef | null {
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
