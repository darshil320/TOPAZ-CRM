import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import DeliveriesManagementClient from "./DeliveriesManagementClient";
import type { DeliveryRow, ReadyOrderRow, StaffRow } from "./types";

/** Terminal statuses — a run in one of these is history, not work in progress. */
const CLOSED_STATUSES = ["delivered", "failed"];

/**
 * How much closed history the board loads.
 *
 * Every run used to be fetched, with its consignments, its lines, and each line's
 * order — a query whose cost grows forever while the board's usefulness does not.
 * OPEN runs are never capped (they are the work, and `openItemIds` in the client is
 * derived from them, so dropping one would wrongly offer an already-loaded item for
 * a second delivery). Only the closed tail is bounded.
 */
const CLOSED_HISTORY_LIMIT = 50;

// A run has no order of its own since 0040 — the orders and the customers come off its
// LINES, and `delivery_consignments` is the authoritative recipient list (one challan
// each). `orders` is embedded through order_items so the board can name every order on a
// mixed run rather than just the first.
const DELIVERY_SELECT =
  "id, status, scheduled_date, delivered_at, vehicle_no, eway_bill_no, notes," +
  " salespersons(name)," +
  " delivery_consignments(id, customer_id, challan_no, delivery_address, customers(id, name, phone))," +
  " delivery_items(order_item_id, order_id, customer_id, consignment_id, received," +
  " order_items(id, description, qty, unit, orders(id, order_no, status)))";

export default async function DeliveriesPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();

  const [{ data: openRuns }, { data: closedRuns }, { data: readyOrders }, { data: staff }] =
    await Promise.all([
      supabase
        .from("deliveries")
        .select(DELIVERY_SELECT)
        .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
        .order("scheduled_date", { ascending: false }),
      supabase
        .from("deliveries")
        .select(DELIVERY_SELECT)
        .in("status", CLOSED_STATUSES)
        .order("scheduled_date", { ascending: false })
        .limit(CLOSED_HISTORY_LIMIT),
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

  // The board renders rows in the order it receives them, so the two halves are merged
  // back into one newest-first list — the same order the single unbounded query gave.
  //
  // The cast is the repo's existing convention for these deep embeds: PostgREST can only
  // infer a row type from a select string it sees as a literal, and this one is shared by
  // both queries. `DeliveryRow` (types.ts) is the hand-written contract instead.
  const deliveries = [
    ...((openRuns ?? []) as unknown as DeliveryRow[]),
    ...((closedRuns ?? []) as unknown as DeliveryRow[]),
  ].sort((a, b) => (b.scheduled_date ?? "").localeCompare(a.scheduled_date ?? ""));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <DeliveriesManagementClient
        deliveries={deliveries}
        readyOrders={(readyOrders ?? []) as unknown as ReadyOrderRow[]}
        staff={(staff ?? []) as unknown as StaffRow[]}
      />
    </div>
  );
}
