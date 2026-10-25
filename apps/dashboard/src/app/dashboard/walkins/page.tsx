import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import { isFrontDesk } from "@/lib/roles";
import { selectInChunks } from "@/lib/supabase/inChunks";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import ClaimButton from "./ClaimButton";

import WalkinQueueListClient, { type WalkinCustomer } from "./WalkinQueueListClient";

// Newest first; the queue is worked from the top.
const QUEUE_LIMIT = 500;

type UnclaimedRow = Omit<WalkinCustomer, "visits">;
type VisitRow = { customer_id: string | null; match_band: string; occurred_at: string };

export default async function WalkinsPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  // The front desk assigns walk-ins from its own board; it never claims one (0052).
  if (isFrontDesk(sp.role)) redirect("/frontdesk");

  const supabase = await createServerSupabaseClient();
  // `unclaimed_walkins` (0052) filters "no active primary" in SQL. Fetching a page of ALL
  // visible customers and subtracting assignments in JS dropped older walk-ins once a
  // role that sees every customer (owner, admin) passed 500 of them. Absent from the
  // generated types until they are regenerated — same widening cast the leads pages use.
  const db = supabase as unknown as { from: (table: string) => any };
  const [{ data: mine }, { data: rows }] = await Promise.all([
    supabase
      .from("customer_assignments")
      .select("customer_id")
      .eq("salesperson_id", sp.id)
      .eq("active", true),
    db
      .from("unclaimed_walkins")
      .select("id, name, phone, primary_interest, created_at")
      .order("created_at", { ascending: false })
      .limit(QUEUE_LIMIT) as Promise<{ data: UnclaimedRow[] | null }>,
  ]);

  const mineIds = new Set((mine ?? []).map((r) => r.customer_id));
  const candidates = (rows ?? []).filter((c) => !mineIds.has(c.id));
  const { data: visits } = await selectInChunks<VisitRow>(
    candidates.map((c) => c.id),
    (chunk) => supabase.from("visits").select("customer_id, match_band, occurred_at").in("customer_id", chunk),
  );
  const visitsByCustomer = new Map<string, VisitRow[]>();
  for (const v of visits) {
    if (v.customer_id) {
      visitsByCustomer.set(v.customer_id, [...(visitsByCustomer.get(v.customer_id) ?? []), v]);
    }
  }
  const unclaimed: WalkinCustomer[] = candidates.map((c) => ({
    ...c,
    visits: visitsByCustomer.get(c.id) ?? [],
  }));

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      <PageHeader
        title="Walk-in Queue"
        subtitle={`${unclaimed.length} unclaimed — first to tap Claim gets the customer`}
      />

      <WalkinQueueListClient unclaimed={unclaimed} />
    </div>
  );
}
