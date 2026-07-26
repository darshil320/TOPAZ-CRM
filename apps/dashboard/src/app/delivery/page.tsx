import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import DeliveryQueueClient from "./DeliveryQueueClient";

export interface DeliveryQueueItem {
  id: string;
  order_id: string;
  order_no: string;
  customer_name: string;
  customer_phone: string | null;
  scheduled_date: string;
  vehicle_no: string | null;
  eway_bill_no: string | null;
  notes: string | null;
  status: string;
  items_summary: string;
}

export default async function DeliveryPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();

  const isElevated = sp.role === "owner" || sp.role === "admin";
  let query = supabase
    .from("deliveries")
    .select("id, order_id, scheduled_date, status, vehicle_no, eway_bill_no, notes, orders!inner(order_no, customers!inner(name, phone), order_items(description, qty))")
    .neq("status", "delivered")
    .order("scheduled_date", { ascending: true });

  if (!isElevated) {
    query = query.eq("driver_salesperson_id", sp.id);
  }

  const { data: rows } = await query;

  const deliveries: DeliveryQueueItem[] = ((rows as any[]) ?? []).map((r) => {
    const orderObj = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    const custObj = orderObj?.customers ? (Array.isArray(orderObj.customers) ? orderObj.customers[0] : orderObj.customers) : null;
    const itemsList = (orderObj?.order_items ?? []).map((it: any) => `${it.qty}x ${it.description}`).join(", ");

    return {
      id: r.id,
      order_id: r.order_id,
      order_no: orderObj?.order_no ?? "ORD-???",
      customer_name: custObj?.name ?? "Customer",
      customer_phone: custObj?.phone ?? null,
      scheduled_date: r.scheduled_date,
      vehicle_no: r.vehicle_no,
      eway_bill_no: r.eway_bill_no,
      notes: r.notes,
      status: r.status,
      items_summary: itemsList || "Order Items",
    };
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div>
          <h2 className="text-lg font-extrabold text-white">ડીલિવરી કામ / Delivery & Installation Queue</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {deliveries.length} order{deliveries.length === 1 ? "" : "s"} scheduled for delivery & installation
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
