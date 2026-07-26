import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import ProductionBoardClient, { ProductionItem, StageDef } from "./ProductionBoardClient";

export default async function ProductionPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();

  const [{ data: stageDefs }, { data: rawItems }, { data: mediaRows }, { data: eventRows }] =
    await Promise.all([
      supabase.from("production_stage_defs").select("*").eq("active", true).order("sort", { ascending: true }),
      supabase
        .from("order_items")
        .select("id, description, qty, unit, dimensions, material, current_stage, current_stage_at, blocked, blocked_at, order_id, workshop_id, orders!inner(order_no, expected_delivery_date, customer_id, customers!inner(name, phone)), workshops(name, type)")
        .not("workshop_id", "is", null)
        .is("production_done_at", null)
        .order("current_stage_at", { ascending: false }),
      supabase
        .from("media")
        .select("id, entity_id, storage_key, mime, created_at")
        .eq("entity_type", "order_item")
        .eq("status", "ready"),
      supabase
        .from("production_events")
        .select("id, order_item_id, kind, stage_code, note, at")
        .order("at", { ascending: true }),
    ]);

  // Sign URLs for media items
  const mediaMap = new Map<string, { id: string; url: string; stageCode: string; createdAt: string }[]>();
  for (const m of mediaRows ?? []) {
    const { data: signed } = await supabase.storage.from("media").createSignedUrl(m.storage_key, 3600);
    if (signed?.signedUrl) {
      const list = mediaMap.get(m.entity_id) || [];
      list.push({
        id: m.id,
        url: signed.signedUrl,
        stageCode: "production",
        createdAt: m.created_at,
      });
      mediaMap.set(m.entity_id, list);
    }
  }

  // Group events by order_item_id
  const eventMap = new Map<string, { id: string; kind: string; stageCode: string; note: string | null; at: string }[]>();
  for (const ev of eventRows ?? []) {
    const list = eventMap.get(ev.order_item_id) || [];
    list.push({
      id: ev.id,
      kind: ev.kind,
      stageCode: ev.stage_code,
      note: ev.note,
      at: ev.at,
    });
    eventMap.set(ev.order_item_id, list);
  }

  const items: ProductionItem[] = ((rawItems as any[]) ?? []).map((r) => {
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
      customer_phone: custObj?.phone ?? null,
      workshop_name: shopObj?.name ?? "Workshop",
      workshop_type: shopObj?.type ?? "own",
      photos: mediaMap.get(r.id) || [],
      events: eventMap.get(r.id) || [],
    };
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <ProductionBoardClient
        items={items}
        stages={(stageDefs ?? []) as StageDef[]}
      />
    </div>
  );
}
