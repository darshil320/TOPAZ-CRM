import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR } from "@/lib/format";
import PageHeader from "@/components/ui/PageHeader";
import { StatCard, StatCardGrid } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import ListRow from "@/components/ui/ListRow";
import { selectInChunks } from "@/lib/supabase/inChunks";

import OpenBalancesListClient from "./OpenBalancesListClient";

function ageDays(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export default async function PaymentsPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [{ data: todayPays }, { data: orders }] = await Promise.all([
    supabase.from("payments").select("amount, kind, paid_at").gte("paid_at", startOfToday.toISOString()),
    supabase
      .from("orders")
      .select("id, order_no, created_at, status, customers(name)")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  // Scoped to the orders this page actually renders, and therefore resolved after
  // them. `order_outstanding` is an aggregate over orders ⋈ payments (0016), so
  // selecting it whole summed every payment ever taken — then discarded every row
  // outside the 500 above. Same figures, bounded work.
  //
  // Chunked: 500 ids in one `.in()` is ~18 KB of query string, over the URL limit.
  // See lib/supabase/inChunks.
  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: outstanding, error: outstandingError } = await selectInChunks<{
    // Both nullable in the generated types: `order_outstanding` is a VIEW, so
    // PostgREST cannot infer NOT NULL from the grouped columns (0016).
    order_id: string | null;
    outstanding: number | null;
  }>(orderIds, (chunk) =>
    supabase.from("order_outstanding").select("order_id, outstanding").in("order_id", chunk),
  );

  const collectedToday = (todayPays ?? []).reduce(
    (sum, p) => sum + (p.kind === "refund" ? -Number(p.amount) : Number(p.amount)),
    0,
  );

  const outstandingByOrder = new Map((outstanding ?? []).map((o) => [o.order_id, Number(o.outstanding ?? 0)]));

  // Orders with a positive balance, excluding cancelled.
  const openOrders = (orders ?? [])
    .filter((o) => o.status !== "cancelled" && (outstandingByOrder.get(o.id) ?? 0) > 0)
    .map((o) => {
      const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;
      return {
        id: o.id,
        order_no: o.order_no,
        name: customer?.name ?? "Unknown",
        due: outstandingByOrder.get(o.id) ?? 0,
        age: ageDays(o.created_at),
      };
    })
    .sort((a, b) => b.due - a.due);

  const buckets = { "0-7": 0, "8-30": 0, "30+": 0 };
  for (const o of openOrders) {
    if (o.age <= 7) buckets["0-7"] += o.due;
    else if (o.age <= 30) buckets["8-30"] += o.due;
    else buckets["30+"] += o.due;
  }
  const totalOutstanding = openOrders.reduce((s, o) => s + o.due, 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Payments" subtitle="Collections, open balances, and aging tracking" />

      {/* Said out loud rather than swallowed: with the balances unread, every order
          looks fully paid, and "no money outstanding" is the single most dangerous
          thing this page could get wrong. */}
      {outstandingError && (
        <div className="rounded-md border border-warn/20 bg-warnS px-4 py-3 text-caption font-semibold text-warn">
          Outstanding balances could not be loaded, so the figures below are incomplete.
          Refresh to retry.
        </div>
      )}

      <StatCardGrid>
        <StatCard label="Collected today" value={formatINR(collectedToday)} />
        <StatCard label="Outstanding 0-7d" value={formatINR(buckets["0-7"])} />
        <StatCard label="Outstanding 8-30d" value={formatINR(buckets["8-30"])} />
        <StatCard label="Outstanding 30+d" value={formatINR(buckets["30+"])} />
      </StatCardGrid>

      <div>
        <SectionHeader
          label="Open balances"
          total={openOrders.length > 0 ? `${openOrders.length} open · ${formatINR(totalOutstanding)}` : undefined}
        />

        <OpenBalancesListClient openOrders={openOrders} />
      </div>
    </div>
  );
}
