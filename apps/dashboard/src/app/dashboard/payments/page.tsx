import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR } from "@/lib/format";
import PageHeader from "@/components/ui/PageHeader";
import { StatCard, StatCardGrid } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import ListRow from "@/components/ui/ListRow";

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

  const [{ data: todayPays }, { data: outstanding }, { data: orders }] = await Promise.all([
    supabase.from("payments").select("amount, kind, paid_at").gte("paid_at", startOfToday.toISOString()),
    supabase.from("order_outstanding").select("order_id, outstanding"),
    supabase
      .from("orders")
      .select("id, order_no, created_at, status, customers(name)")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

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

        {openOrders.length === 0 ? (
          <p className="mt-6 text-center text-body text-t2">
            All orders are fully paid — there are no outstanding balances at this time.
          </p>
        ) : (
          openOrders.map((o) => (
            <ListRow
              key={o.id}
              href={`/dashboard/orders/${o.id}`}
              primary={o.order_no}
              secondary={`${o.name} · ${o.age}d old`}
              trailing={formatINR(o.due)}
              trailingTone="warn"
            />
          ))
        )}
      </div>
    </div>
  );
}
