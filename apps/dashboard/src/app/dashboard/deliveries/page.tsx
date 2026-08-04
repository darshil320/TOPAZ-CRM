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
      // `delivery_items` (0039) is what turns a board row from "ORD-41" into "ORD-41 · 2
      // of 5 items", and `challan_no` (0037) tells the row whether its document exists.
      .select(
        "id, order_id, status, scheduled_date, delivered_at, vehicle_no, eway_bill_no, notes, challan_no, orders!inner(order_no, status, customers!inner(name, phone)), salespersons(name), delivery_items(order_item_id, order_items(id, description, qty, unit))",
      )
      .order("scheduled_date", { ascending: false }),
    // Phone comes along so the order picker can be searched by the number the
    // customer just called from. The item list comes along so the picker can show which
    // pieces are deliverable and, for the rest, WHY not.
    supabase
      .from("orders")
      .select(
        "id, order_no, status, customers!inner(name, phone), order_items(id, description, qty, unit, production_done_at, delivered_at, current_stage, workshops(name))",
      )
      .in("status", ["ready", "in_production"])
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
