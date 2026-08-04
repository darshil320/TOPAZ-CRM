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
      // Module 14 additions: `transit_transfer_id` (is it on a lorry right now), the
      // active assignment's `due_at` (the deadline WITH a time), and the item's route
      // legs so the card can show "Leg 2 / 3 → Sharma Furniture".
      supabase
        .from("order_items")
        .select(
          "id, description, qty, unit, dimensions, material, current_stage, current_stage_at," +
            " blocked, blocked_at, order_id, workshop_id, transit_transfer_id," +
            " orders!inner(order_no, expected_delivery_date, customer_id," +
            " customers!inner(name, phone))," +
            " workshops(name, type)," +
            " order_item_assignments(due_at, active)," +
            " order_item_route_legs(seq, status, stage_to, workshop_id, workshops(name))",
        )
        .not("workshop_id", "is", null)
        .is("production_done_at", null)
        .order("current_stage_at", { ascending: false }),
      supabase
        .from("media")
        // `stage_code` (0036) is what makes the drawer's photo captions real — before
        // it, every tile was hardcoded to the string "production".
        .select("id, entity_id, storage_key, mime, created_at, stage_code, salespersons(name)")
        .eq("entity_type", "order_item")
        .eq("status", "ready"),
      supabase
        .from("production_events")
        .select("id, order_item_id, kind, stage_code, note, at")
        .order("at", { ascending: true }),
    ]);

  // Sign URLs for media items. `stageCode` is null for anything uploaded before 0036
  // and for photos that were never attached to a stage — the drawer labels those
  // honestly rather than guessing.
  const stageSort = new Map((stageDefs ?? []).map((s) => [s.code, s.sort]));
  const mediaMap = new Map<string, ProductionItem["photos"]>();
  for (const m of mediaRows ?? []) {
    const { data: signed } = await supabase.storage.from("media").createSignedUrl(m.storage_key, 3600);
    if (signed?.signedUrl) {
      const uploader = Array.isArray(m.salespersons) ? m.salespersons[0] : m.salespersons;
      const list = mediaMap.get(m.entity_id) || [];
      list.push({
        id: m.id,
        url: signed.signedUrl,
        stageCode: m.stage_code,
        createdAt: m.created_at,
        uploadedBy: uploader?.name ?? null,
      });
      mediaMap.set(m.entity_id, list);
    }
  }
  // Order every item's photos by the stage they document, so the drawer reads in the
  // order the work happened. Unstaged photos sink to the bottom; within a stage, oldest
  // first, because the first photo of a stage is usually the one that shows the problem.
  for (const list of mediaMap.values()) {
    list.sort((a, b) => {
      const sa = a.stageCode ? stageSort.get(a.stageCode) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const sb = b.stageCode ? stageSort.get(b.stageCode) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      return sa !== sb ? sa - sb : a.createdAt.localeCompare(b.createdAt);
    });
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

    // The ACTIVE assignment carries the live deadline; the retired ones are history.
    // Filtering here rather than in PostgREST because an embedded-row filter on a
    // to-many relation silently drops the PARENT row when nothing matches.
    const assignments = (r.order_item_assignments ?? []) as { due_at: string | null; active: boolean }[];
    const activeAssignment = assignments.find((a) => a.active) ?? null;

    const legs = (r.order_item_route_legs ?? []) as {
      seq: number;
      status: string;
      stage_to: string;
      workshop_id: string;
      workshops: { name: string } | { name: string }[] | null;
    }[];
    const liveLegs = legs.filter((l) => l.status !== "cancelled");
    const activeLeg = legs.find((l) => l.status === "active") ?? null;
    const nextLeg = activeLeg
      ? liveLegs.find((l) => l.seq === activeLeg.seq + 1) ?? null
      : null;
    const nextShop = nextLeg
      ? Array.isArray(nextLeg.workshops)
        ? nextLeg.workshops[0]
        : nextLeg.workshops
      : null;

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
      due_at: activeAssignment?.due_at ?? null,
      transit_transfer_id: r.transit_transfer_id ?? null,
      leg_seq: activeLeg?.seq ?? null,
      leg_total: liveLegs.length,
      next_workshop_name: nextShop?.name ?? null,
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
