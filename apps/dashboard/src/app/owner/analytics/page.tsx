import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import {
  countByStage,
  conversionRate,
  wonByDay,
  parseBudgetToINR,
  formatINR,
  type StageRow,
} from "@/lib/analytics";
import AlertFeed, { type AlertItem } from "./AlertFeed";

const FUNNEL = [
  { key: "new", label: "New", bar: "bg-slate-400" },
  { key: "talking", label: "Talking", bar: "bg-blue-500" },
  { key: "follow_up", label: "Follow-up", bar: "bg-amber-500" },
  { key: "won", label: "Won", bar: "bg-green-500" },
  { key: "lost", label: "Lost", bar: "bg-red-400" },
] as const;

export default async function AnalyticsPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!isOwnerRole(sp)) redirect("/dashboard");

  const supabase = await createServerSupabaseClient();

  const [{ data: stageRows }, { count: customersTotal }, { data: budgets }, { data: alertRows }] =
    await Promise.all([
      supabase.from("pipeline_stages").select("stage, updated_at"),
      supabase.from("customers").select("id", { count: "exact", head: true }),
      supabase.from("conversations").select("customer_id, budget").limit(1000),
      supabase
        .from("alerts")
        .select("id, customer_id, type, detail, created_at, customers(name)")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  const rows = (stageRows ?? []) as StageRow[];
  const counts = countByStage(rows);
  const activePipeline = counts.talking + counts.follow_up;
  const rate = conversionRate(counts);
  const daily = wonByDay(rows, 14, new Date());
  const maxDaily = Math.max(1, ...daily.map((d) => d.count));
  const maxFunnel = Math.max(1, ...FUNNEL.map((f) => counts[f.key]));

  // Best-effort value: max logged budget per won customer, summed (§Phase-2 order value not modelled).
  const wonAt = new Map<string, number>();
  for (const b of budgets ?? []) {
    const parsed = parseBudgetToINR(b.budget);
    if (parsed && b.customer_id) {
      wonAt.set(b.customer_id, Math.max(wonAt.get(b.customer_id) ?? 0, parsed));
    }
  }
  const estValue = [...wonAt.values()].reduce((s, v) => s + v, 0);

  const initialAlerts: AlertItem[] = (alertRows ?? []).map((a: any) => ({
    id: a.id,
    type: a.type,
    detail: a.detail,
    created_at: a.created_at,
    customer_id: a.customer_id,
    customer_name: Array.isArray(a.customers) ? (a.customers[0]?.name ?? null) : a.customers?.name ?? null,
  }));

  const kpis = [
    { label: "Won deals", value: String(counts.won), sub: "all time" },
    { label: "Conversion", value: `${Math.round(rate * 100)}%`, sub: "won / closed" },
    { label: "Active pipeline", value: String(activePipeline), sub: "talking + follow-up" },
    { label: "Total customers", value: String(customersTotal ?? 0), sub: "in CRM" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Analytics</h1>
        <p className="text-sm text-slate-500 mt-0.5">Conversion, daily sales, and live intent triggers</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{k.label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1.5">{k.value}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {estValue > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Est. won value</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Best-effort, parsed from logged budgets — not billed order value</p>
          </div>
          <p className="text-2xl font-bold text-green-600">{formatINR(estValue)}</p>
        </div>
      )}

      {/* Conversion funnel */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-4">Pipeline Funnel</p>
        <div className="space-y-3">
          {FUNNEL.map((f) => {
            const value = counts[f.key];
            return (
              <div key={f.key} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs font-medium text-slate-600">{f.label}</span>
                <div className="flex-1 h-6 bg-slate-50 rounded-lg overflow-hidden">
                  <div
                    className={`h-full ${f.bar} rounded-lg transition-all`}
                    style={{ width: `${Math.max(value === 0 ? 0 : 6, (value / maxFunnel) * 100)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm font-semibold text-slate-700 tabular-nums">{value}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily won trend */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-4">Won Deals — Last 14 Days</p>
        <div className="flex items-end justify-between gap-1 h-28">
          {daily.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0 group">
              <span className="text-[10px] font-semibold text-slate-500 tabular-nums">{d.count > 0 ? d.count : ""}</span>
              <div className="w-full flex items-end justify-center h-20">
                <div
                  className="w-full max-w-[18px] bg-green-500/80 group-hover:bg-green-500 rounded-t-md transition-all"
                  style={{ height: `${d.count === 0 ? 2 : (d.count / maxDaily) * 100}%` }}
                />
              </div>
              <span className="text-[9px] text-slate-400 truncate w-full text-center leading-tight">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Live trigger / alert feed */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Live Triggers &amp; Alerts</p>
        </div>
        <AlertFeed initialAlerts={initialAlerts} />
      </div>
    </div>
  );
}
