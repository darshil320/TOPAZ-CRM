import { redirect } from "next/navigation";
import { AlertTriangle, Factory } from "lucide-react";
import { getCurrentSalesperson } from "@/lib/auth";
import { getMyQueue } from "@/lib/production/reads";
import { capabilitiesAt } from "@/lib/production/queueGuards";
import IncomingTransfers from "./IncomingTransfers";
import WorkshopQueueClient from "./WorkshopQueueClient";

/**
 * The workshop PWA's My Queue.
 *
 * ─── WHY THIS READS THE API AND NOT SUPABASE (it used to) ──────────────────────
 * Two reasons, both load-bearing:
 *
 *  1. **The roster.** This page used to filter workshops by
 *     `manager_salesperson_id = me`. Module 14 made that column a DENORM of the
 *     `workshop_staff` roster (0029), and a SUB-MANAGER matches it never — so the
 *     person the hierarchy exists for would have opened the app to an empty queue.
 *     `GET /api/production/my-queue` scopes on the roster instead.
 *  2. **Money.** The old query selected `order_items` directly. `workshop_manager` has
 *     no SELECT policy on that table and must never get one (it carries unit_price /
 *     line_total / gst_rate, 0024:118) — the query only appeared to work because the
 *     rows came back empty or via a broader session. The API's projection is the
 *     money-blind boundary.
 */
export default async function WorkshopPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const { data, error } = await getMyQueue();

  const workshops = data?.workshops ?? [];
  const items = data?.items ?? [];
  const stages = data?.stages ?? [];
  const incoming = data?.incoming_transfers ?? [];

  // Receiving a consignment is a CUSTODY action, so ask the API's capability array —
  // the roster role alone is the guess that broke the stage buttons (REQ 3).
  const canReceiveSomewhere = workshops.some((w) => capabilitiesAt(w).has("custody"));
  const isLeadSomewhere = workshops.some((w) => w.staff_role === "lead");
  const overdueCount = items.filter((item) => {
    const due = item.leg_due_at ?? item.due_at;
    return due !== null && new Date(due).getTime() < Date.now();
  }).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div>
          <h2 className="text-lg font-extrabold text-white">मेरा प्रोडक्शन काम / My Production Queue</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {items.length} item{items.length === 1 ? "" : "s"} assigned
            {overdueCount > 0 && (
              <span className="text-red-400 font-bold"> · {overdueCount} overdue</span>
            )}
          </p>
        </div>
        <div className="text-right shrink-0 space-y-1">
          <span className="block font-mono text-xs font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 px-2.5 py-1 rounded-md">
            {workshops.length} site{workshops.length === 1 ? "" : "s"}
          </span>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {isLeadSomewhere ? "मुख्य प्रबंधक / Lead" : "सहायक प्रबंधक / Sub-manager"}
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs font-semibold text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {workshops.length === 0 && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <Factory className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-white">कोई वर्कशॉप असाइन नहीं है / No workshop assigned</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Ask the owner to add you to a workshop&apos;s staff list (Admin → Workshops →
            Staff). Until then there is nothing here to show you.
          </p>
        </div>
      )}

      {/* Incoming FIRST: goods waiting on a lorry outside are more urgent than the
          work already on the floor, and only a lead can clear them. */}
      <IncomingTransfers transfers={incoming} canReceive={canReceiveSomewhere} />

      {workshops.length > 0 && (
        <WorkshopQueueClient
          initialItems={items}
          stages={stages}
          workshops={workshops}
        />
      )}
    </div>
  );
}
