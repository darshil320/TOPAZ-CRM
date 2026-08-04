import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import DeliveriesManagementClient from "./DeliveriesManagementClient";
import type { DeliveryRow, ReadyOrderRow, StaffRow } from "./types";

export default async function DeliveriesPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();

  const [{ data: deliveries }, { data: readyOrders }, { data: staff }] = await Promise.all([
    supabase
      .from("deliveries")
      // A run has no order of its own since 0040 — the orders and the customers come off
      // its LINES, and `delivery_consignments` is the authoritative recipient list (one
      // challan each). `orders` is embedded through order_items so the board can name
      // every order on a mixed run rather than just the first.
      .select(
        "id, status, scheduled_date, delivered_at, vehicle_no, eway_bill_no, notes," +
          " salespersons(name)," +
          " delivery_consignments(id, customer_id, challan_no, delivery_address, customers(id, name, phone))," +
          " delivery_items(order_item_id, order_id, customer_id, consignment_id, received," +
          " order_items(id, description, qty, unit, orders(id, order_no, status)))",
      )
      .order("scheduled_date", { ascending: false }),
    // Phone comes along so the order picker can be searched by the number the
    // customer just called from. The item list comes along so the picker can show which
    // pieces are deliverable and, for the rest, WHY not.
    //
    // `fulfillment_status <> 'fully_delivered'` IS THE LOAD-BEARING FILTER (0040). A
    // part-shipped order stays 'ready' by design, but if this list were narrowed on status
    // alone an order whose remaining pieces are still in production could drop out and its
    // tail could never be scheduled — the exact failure 0039 was written to fix.
    supabase
      .from("orders")
      .select(
        "id, order_no, status, fulfillment_status, customers!inner(id, name, phone)," +
          " order_items(id, description, qty, unit, production_done_at, delivered_at, current_stage, workshops(name))",
      )
      .in("status", ["ready", "in_production"])
      .neq("fulfillment_status", "fully_delivered")
      .order("created_at", { ascending: false }),
    supabase
      .from("salespersons")
      .select("id, name, role")
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <DeliveriesManagementClient
        deliveries={(deliveries ?? []) as unknown as DeliveryRow[]}
        readyOrders={(readyOrders ?? []) as unknown as ReadyOrderRow[]}
        staff={(staff ?? []) as unknown as StaffRow[]}
      />
    </div>
  );
}
