import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import WorkshopQueueClient from "./WorkshopQueueClient";

export interface WorkshopQueueItem {
  id: string;
  description: string;
  qty: number;
  unit: string | null;
  dimensions: string | null;
  material: string | null;
  current_stage: string | null;
  current_stage_at: string | null;
  blocked: boolean;
  blocked_at: string | null;
  order_id: string;
  order_no: string;
  customer_name: string;
  expected_delivery_date: string | null;
  workshop_name: string;
  workshop_id: string;
}

export interface StageDef {
  code: string;
  sort: number;
  label_en: string;
  label_gu: string | null;
  photo_required: boolean;
}

export default async function WorkshopPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();

  // 1. Fetch workshops managed by this staff member, or all active workshops if owner/admin
  const isElevated = sp.role === "owner" || sp.role === "admin";
  
  let workshopQuery = supabase.from("workshops").select("id, name, type, manager_salesperson_id").eq("active", true);
  if (!isElevated) {
    workshopQuery = workshopQuery.eq("manager_salesperson_id", sp.id);
  }

  const [{ data: workshops }, { data: stageDefs }] = await Promise.all([
    workshopQuery,
    supabase.from("production_stage_defs").select("*").eq("active", true).order("sort", { ascending: true }),
  ]);

  const workshopList = workshops ?? [];
  const workshopIds = workshopList.map((w) => w.id);

  // 2. Fetch assigned items for these workshops
  let items: WorkshopQueueItem[] = [];

  if (workshopIds.length > 0) {
    const { data: rows } = await supabase
      .from("order_items")
      .select("id, description, qty, unit, dimensions, material, current_stage, current_stage_at, blocked, blocked_at, order_id, workshop_id, orders!inner(order_no, expected_delivery_date, customers!inner(name)), workshops!inner(name)")
      .in("workshop_id", workshopIds)
      .is("production_done_at", null)
      .order("current_stage_at", { ascending: true });

    items = ((rows as any[]) ?? []).map((r) => {
      const orderObj = Array.isArray(r.orders) ? r.orders[0] : r.orders;
      const custObj = orderObj?.customers ? (Array.isArray(orderObj.customers) ? orderObj.customers[0] : orderObj.customers) : null;
      const shopObj = Array.isArray(r.workshops) ? r.workshops[0] : r.workshops;

      return {
        id: r.id,
        description: r.description,
        qty: r.qty,
        unit: r.unit,
        dimensions: r.dimensions,
        material: r.material,
        current_stage: r.current_stage,
        current_stage_at: r.current_stage_at,
        blocked: r.blocked,
        blocked_at: r.blocked_at,
        order_id: r.order_id,
        order_no: orderObj?.order_no ?? "ORD-???",
        customer_name: custObj?.name ?? "Customer",
        expected_delivery_date: orderObj?.expected_delivery_date ?? null,
        workshop_name: shopObj?.name ?? "Workshop",
        workshop_id: r.workshop_id,
      };
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div>
          <h2 className="text-lg font-extrabold text-white">મારું ઉત્પાદન કામ / My Production Queue</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {items.length} item{items.length === 1 ? "" : "s"} assigned for active production
          </p>
        </div>
        <div className="text-right font-mono text-xs font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 px-2.5 py-1 rounded-md">
          {workshopList.length} site{workshopList.length === 1 ? "" : "s"}
        </div>
      </div>

      <WorkshopQueueClient
        initialItems={items}
        stages={(stageDefs ?? []) as StageDef[]}
      />
    </div>
  );
}
