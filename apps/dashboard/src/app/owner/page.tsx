import { createServerSupabaseClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const STAGES = ["new", "talking", "follow_up", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_CONFIG: Record<Stage, { label: string; dot: string; accent: string }> = {
  new:       { label: "New",       dot: "bg-slate-400",  accent: "border-slate-200 bg-slate-50/80" },
  talking:   { label: "Talking",   dot: "bg-blue-500",   accent: "border-blue-200 bg-blue-50/80" },
  follow_up: { label: "Follow-up", dot: "bg-amber-500",  accent: "border-amber-200 bg-amber-50/80" },
  won:       { label: "Won",       dot: "bg-green-500",  accent: "border-green-200 bg-green-50/80" },
  lost:      { label: "Lost",      dot: "bg-red-400",    accent: "border-red-200 bg-red-50/80" },
};

export default async function OwnerPage() {
  const supabase = await createServerSupabaseClient();
  const { data: sp } = await supabase.from("salespersons").select("role").single();
  if (sp?.role !== "owner") redirect("/dashboard");

  const { data: rows } = await supabase
    .from("pipeline_stages")
    .select("stage, customer_id, customers(id, name, phone, primary_interest)");

  const byStage = STAGES.reduce(
    (acc, s) => ({ ...acc, [s]: [] as any[] }),
    {} as Record<Stage, any[]>,
  );
  for (const row of rows ?? []) {
    byStage[row.stage as Stage]?.push(row.customers);
  }

  const total = Object.values(byStage).reduce((s, arr) => s + arr.length, 0);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Pipeline</h1>
        <p className="text-sm text-slate-500 mt-0.5">{total} customer{total !== 1 ? "s" : ""} across all stages</p>
      </div>

      <div className="grid grid-cols-5 gap-3 min-w-0">
        {STAGES.map((stage) => {
          const cfg = STAGE_CONFIG[stage];
          const customers = byStage[stage];
          return (
            <div key={stage} className={`rounded-2xl border overflow-hidden flex flex-col ${cfg.accent}`}>
              {/* Column header */}
              <div className="px-3.5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                  <span className="text-xs font-bold text-slate-700 tracking-tight">{cfg.label}</span>
                </div>
                <span className="text-[11px] font-semibold text-slate-400 bg-white/80 border border-slate-200/80 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {customers.length}
                </span>
              </div>

              {/* Cards */}
              <div className="p-2 space-y-1.5 flex-1 min-h-[120px]">
                {customers.length === 0 && (
                  <div className="flex items-center justify-center h-16 text-xs text-slate-300 font-medium">
                    Empty
                  </div>
                )}
                {customers.map((c: any) => (
                  <a
                    key={c?.id}
                    href={`/dashboard/customers/${c?.id}`}
                    className="block bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-xl px-3 py-2.5 transition-all group shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-bold text-white">
                          {c?.name ? c.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase() : "?"}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 group-hover:text-blue-700 truncate leading-tight">
                          {c?.name ?? "Unknown"}
                        </p>
                        {c?.primary_interest && (
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">{c.primary_interest}</p>
                        )}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
