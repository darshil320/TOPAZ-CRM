import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import DeliveriesManagementClient from "./DeliveriesManagementClient";

export default async function DeliveriesPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();

  const [{ data: deliveries }, { data: readyOrders }, { data: staff }] = await Promise.all([
    supabase
      .from("deliveries")
      .select("id, order_id, status, scheduled_date, delivered_at, vehicle_no, eway_bill_no, notes, orders!inner(order_no, status, customers!inner(name, phone)), salespersons(name)")
      .order("scheduled_date", { ascending: false }),
    supabase
      .from("orders")
      .select("id, order_no, status, customers!inner(name)")
      .in("status", ["ready", "in_production"])
      .order("created_at", { ascending: false }),
    supabase
      .from("salespersons")
      .select("id, name, role")
      .eq("active", true),
  ]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <DeliveriesManagementClient
        deliveries={(deliveries as any[]) ?? []}
        readyOrders={(readyOrders as any[]) ?? []}
        staff={(staff as any[]) ?? []}
      />
    </div>
  );
}
