import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import DeliveryQueueClient from "./DeliveryQueueClient";

/** One line ON this run — a piece the driver physically has to hand over (0039). */
export interface DeliveryLine {
  /** delivery_items.id — the row the tick is written to (0040), NOT order_items.id. */
  id: string;
  orderItemId: string;
  orderNo: string;
  description: string;
  qty: number;
  unit: string | null;
}

/**
 * One DROP on the run: everything for a single customer (0040).
 *
 * A run can visit two customers, so the driver's card is a list of stops, each with its own
 * phone number and its own goods. Before 0040 the screen assumed one order and one customer
 * per delivery and would have shown the second customer's pieces under the first one's name.
 */
export interface DeliveryStop {
  consignmentId: string | null;
  customerName: string;
  customerPhone: string | null;
  address: string | null;
  orderNos: string[];
  lines: DeliveryLine[];
}

export interface DeliveryQueueItem {
  id: string;
  scheduled_date: string;
  vehicle_no: string | null;
  eway_bill_no: string | null;
  notes: string | null;
  status: string;
  items_summary: string;
  /**
   * Every drop on this run, in delivery order. Empty for a pre-0039 delivery whose backfill
   * has not run: the checklist then degrades to the old "whole order" behaviour rather than
   * blocking the tap.
   */
  stops: DeliveryStop[];
}

export default async function DeliveryPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();

  const isElevated = sp.role === "owner" || sp.role === "admin";
  let query = supabase
    .from("deliveries")
    // No `order_id` and no single customer since 0040 — the drops come off the run's
    // consignments and its lines. `delivery_items.id` is selected because the driver's tick
    // is an UPDATE of that row.
    .select(
      "id, scheduled_date, status, vehicle_no, eway_bill_no, notes," +
        " delivery_consignments(id, customer_id, delivery_address, customers(name, phone))," +
        " delivery_items(id, order_item_id, consignment_id, customer_id, received," +
        " order_items(id, description, qty, unit, orders(order_no, customers(name, phone))))",
    )
    .neq("status", "delivered")
    .order("scheduled_date", { ascending: true });

  if (!isElevated) {
    query = query.eq("driver_salesperson_id", sp.id);
  }

  const { data: rows } = await query;

  const one = <T,>(value: T | T[] | null | undefined): T | null =>
    value == null ? null : Array.isArray(value) ? (value[0] ?? null) : value;

  const deliveries: DeliveryQueueItem[] = ((rows as any[]) ?? []).map((row) => {
    const consignments = (row.delivery_consignments ?? []) as any[];
    const items = (row.delivery_items ?? []) as any[];

    /**
     * Group the lines by consignment — the recipient's own paperwork group. A line with no
     * consignment (a legacy row, or one whose customer has no consignment) is grouped under
     * its customer_id so it still reaches the screen rather than vanishing.
     */
    const buckets = new Map<string, DeliveryStop>();
    for (const line of items) {
      const orderItem = one<any>(line.order_items);
      const order = one<any>(orderItem?.orders);
      const consignment = consignments.find((c) => c.id === line.consignment_id) ?? null;
      const fromConsignment = one<any>(consignment?.customers);
      const fromOrder = one<any>(order?.customers);
      const key = line.consignment_id ?? line.customer_id ?? "unassigned";

      const existing = buckets.get(key);
      const stop: DeliveryStop = existing ?? {
        consignmentId: consignment?.id ?? null,
        customerName: fromConsignment?.name ?? fromOrder?.name ?? "Customer",
        customerPhone: fromConsignment?.phone ?? fromOrder?.phone ?? null,
        address: consignment?.delivery_address ?? null,
        orderNos: [],
        lines: [],
      };

      const orderNo = order?.order_no ?? "ORD-???";
      if (!stop.orderNos.includes(orderNo)) stop.orderNos.push(orderNo);
      stop.lines.push({
        id: line.id,
        orderItemId: line.order_item_id,
        orderNo,
        description: orderItem?.description ?? "Item",
        qty: orderItem?.qty ?? 1,
        unit: orderItem?.unit ?? null,
      });
      buckets.set(key, stop);
    }

    const stops = [...buckets.values()];
    const summary = stops
      .flatMap((stop) => stop.lines.map((line) => `${line.qty}x ${line.description}`))
      .join(", ");

    return {
      id: row.id,
      scheduled_date: row.scheduled_date,
      vehicle_no: row.vehicle_no,
      eway_bill_no: row.eway_bill_no,
      notes: row.notes,
      status: row.status,
      items_summary: summary || "Order Items",
      stops,
    };
  });

  const dropCount = deliveries.reduce((total, run) => total + Math.max(run.stops.length, 1), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div>
          <h2 className="text-lg font-extrabold text-white">डिलीवरी काम / Delivery &amp; Installation Queue</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {deliveries.length} run{deliveries.length === 1 ? "" : "s"} · {dropCount} drop
            {dropCount === 1 ? "" : "s"} scheduled for delivery &amp; installation
          </p>
        </div>
        <div className="text-right font-mono text-xs font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 px-2.5 py-1 rounded-md">
          {deliveries.length} active
        </div>
      </div>

      <DeliveryQueueClient initialDeliveries={deliveries} />
    </div>
  );
}
