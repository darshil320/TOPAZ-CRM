import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const STAGES = ["new", "talking", "follow_up", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  talking: "Talking",
  follow_up: "Follow-up",
  won: "Won",
  lost: "Lost",
};

export default async function OwnerPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sp } = await supabase
    .from("salespersons")
    .select("role")
    .single();
  if (sp?.role !== "owner") redirect("/dashboard");

  const { data: rows } = await supabase
    .from("pipeline_stages")
    .select("stage, customer_id, customers(id, name, primary_interest)");

  const byStage = STAGES.reduce((acc, s) => ({ ...acc, [s]: [] as any[] }), {} as Record<Stage, any[]>);
  for (const row of rows ?? []) {
    byStage[row.stage as Stage]?.push(row.customers);
  }

  return (
    <main className="p-4">
      <h1 className="text-lg font-semibold mb-4">Pipeline</h1>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {STAGES.map((stage) => (
          <div key={stage} className="min-w-[200px] bg-white border border-gray-200 rounded-xl p-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {STAGE_LABEL[stage]}
              <span className="ml-1 text-gray-400">({byStage[stage].length})</span>
            </h2>
            <ul className="space-y-1.5">
              {byStage[stage].map((c: any) => (
                <li key={c?.id}>
                  <a
                    href={`/dashboard/customers/${c?.id}`}
                    className="block bg-gray-50 hover:bg-blue-50 rounded-lg px-2 py-1.5 text-sm transition-colors"
                  >
                    <span className="font-medium">{c?.name ?? "Unknown"}</span>
                    {c?.primary_interest && (
                      <p className="text-xs text-gray-400 truncate">{c.primary_interest}</p>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
