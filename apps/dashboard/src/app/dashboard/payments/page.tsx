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
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      {/* Uncarded Standard Page Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Payments</h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500 font-medium">
          Collections, open balances, and aging tracking
        </p>
      </div>

      {/* 4 Stat Cards in Unified Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="COLLECTED TODAY"
          value={formatINR(collectedToday)}
          valueColor="text-emerald-700"
          badgeBg="bg-emerald-50 text-emerald-600"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-6h6" />
            </svg>
          }
        />
        <StatCard
          label="OUTSTANDING 0-7D"
          value={formatINR(buckets["0-7"])}
          valueColor="text-slate-900"
          badgeBg="bg-blue-50 text-blue-600"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="OUTSTANDING 8-30D"
          value={formatINR(buckets["8-30"])}
          valueColor="text-amber-700"
          badgeBg="bg-amber-50 text-amber-600"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
        <StatCard
          label="OUTSTANDING 30+D"
          value={formatINR(buckets["30+"])}
          valueColor="text-rose-700"
          badgeBg="bg-rose-50 text-rose-600"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Open Balances List Section */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Open Balances</h2>
            {openOrders.length > 0 && (
              <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                {openOrders.length} Pending
              </span>
            )}
          </div>
          <span className="text-xs font-bold text-slate-500">{formatINR(totalOutstanding)} total</span>
        </div>

        {openOrders.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50/50 px-4 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-2 font-bold text-lg">
              ✓
            </div>
            <p className="text-xs font-bold text-slate-700">All orders fully paid!</p>
            <p className="text-[11px] text-slate-400 mt-1">There are no outstanding balances at this time.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {openOrders.map((o) => {
              const initials = o.name
                ? o.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
                : "?";
              return (
                <Link
                  key={o.id}
                  href={`/dashboard/orders/${o.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 sm:p-4 transition-all hover:border-slate-300 hover:shadow-xs active:scale-[0.99] group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center font-extrabold text-xs shrink-0 shadow-2xs">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                          {o.order_no}
                        </span>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                          {o.age}d old
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500 font-medium">
                        Customer: <span className="text-slate-800 font-semibold">{o.name}</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 block">
                      {formatINR(o.due)}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 group-hover:text-blue-600 transition-colors inline-flex items-center gap-0.5">
                      View Order &rarr;
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueColor,
  badgeBg,
  icon,
}: {
  label: string;
  value: string;
  valueColor: string;
  badgeBg: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl sm:rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-xs transition-all hover:shadow-sm space-y-2 flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{label}</p>
        <div className={`w-8 h-8 rounded-xl ${badgeBg} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
      </div>
      <p className={`text-xl sm:text-2xl font-black tracking-tight ${valueColor}`}>{value}</p>
    </div>
  );
}
