import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import ClaimButton from "./ClaimButton";

const BAND_CONFIG: Record<string, { label: string; color: string }> = {
  REPEAT: { label: "Repeat", color: "bg-green-100 text-green-700 border-green-200" },
  UNCERTAIN: { label: "Uncertain", color: "bg-amber-100 text-amber-700 border-amber-200" },
  NEW: { label: "New", color: "bg-slate-100 text-slate-600 border-slate-200" },
};

export default async function WalkinsPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (isOwnerRole(sp)) redirect("/owner");

  const supabase = await createServerSupabaseClient();
  const [{ data: mine }, { data: customers }] = await Promise.all([
    supabase
      .from("customer_assignments")
      .select("customer_id")
      .eq("salesperson_id", sp.id)
      .eq("active", true),
    supabase
      .from("customers")
      .select("id, name, phone, primary_interest, created_at, visits(match_band, occurred_at)")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const mineIds = new Set((mine ?? []).map((r) => r.customer_id));
  // RLS (0007) only exposes rows the caller is assigned to, or that have no
  // active primary yet — so anything not in `mineIds` here IS the unclaimed queue.
  const unclaimed = (customers ?? []).filter((c) => !mineIds.has(c.id));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-bold text-slate-900">Walk-in Queue</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {unclaimed.length} unclaimed — first to tap Claim gets the customer
        </p>
      </div>

      {unclaimed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm font-medium text-slate-600">No unclaimed walk-ins</p>
          <p className="text-xs text-slate-400 mt-1">New visitors will appear here until claimed.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {unclaimed.map((c) => {
            const visits = (c.visits ?? []).slice().sort(
              (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
            );
            const latest = visits[0];
            const bandCfg = latest ? BAND_CONFIG[latest.match_band] ?? BAND_CONFIG.NEW : null;
            return (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-slate-900 truncate">
                      {c.name ?? "Unknown"}
                    </span>
                    {bandCfg && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${bandCfg.color}`}>
                        {bandCfg.label}
                      </span>
                    )}
                  </div>
                  {c.primary_interest ? (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{c.primary_interest}</p>
                  ) : c.phone ? (
                    <p className="text-xs text-slate-400 mt-0.5">{c.phone}</p>
                  ) : null}
                </div>
                <ClaimButton customerId={c.id} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
