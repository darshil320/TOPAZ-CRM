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

export interface DeliveryRow {
  id: string;
  order_id: string;
  status: string;
  scheduled_date: string;
  delivered_at: string | null;
  vehicle_no: string | null;
  eway_bill_no: string | null;
  notes: string | null;
  orders?: OrderRef | OrderRef[] | null;
  salespersons?: StaffRef | StaffRef[] | null;
}

export interface ReadyOrderRow {
  id: string;
  order_no: string;
  status: string;
  customers?: CustomerRef | CustomerRef[] | null;
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
