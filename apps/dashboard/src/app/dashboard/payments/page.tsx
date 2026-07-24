import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";

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
    // Explicit ordering so the 500-row cap is deterministic (newest first) rather
    // than dropping arbitrary rows as the table grows (code-review MEDIUM).
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
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-bold text-slate-900">Payments</h1>
        <p className="mt-0.5 text-sm text-slate-500">Collections &amp; outstanding</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Collected today" value={formatINR(collectedToday)} tone="green" />
        <Stat label="Outstanding 0-7d" value={formatINR(buckets["0-7"])} />
        <Stat label="Outstanding 8-30d" value={formatINR(buckets["8-30"])} tone="amber" />
        <Stat label="Outstanding 30+d" value={formatINR(buckets["30+"])} tone="red" />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Open balances</p>
        <p className="text-sm text-slate-500">{formatINR(totalOutstanding)} total</p>
      </div>

      {openOrders.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          Nothing outstanding — all orders are paid up.
        </div>
      ) : (
        <div className="space-y-2">
          {openOrders.map((o) => (
            <Link
              key={o.id}
              href={`/dashboard/orders/${o.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:border-slate-300"
            >
              <div className="min-w-0">
                <span className="text-sm font-semibold text-slate-900">{o.order_no}</span>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {o.name} · {o.age}d old
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-amber-700">{formatINR(o.due)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" | "red" }) {
  const color =
    tone === "green" ? "text-green-700" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-1 text-base font-bold ${color}`}>{value}</p>
    </div>
  );
}
