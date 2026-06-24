import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Link from "next/link";

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "bg-slate-100 text-slate-600" },
  talking: { label: "Talking", color: "bg-blue-100 text-blue-700" },
  follow_up: { label: "Follow-up", color: "bg-amber-100 text-amber-700" },
  won: { label: "Won", color: "bg-green-100 text-green-700" },
  lost: { label: "Lost", color: "bg-red-100 text-red-600" },
};

function CustomerAvatar({ name }: { name: string | null }) {
  const initials = name
    ? name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "?";
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0 shadow-sm">
      <span className="text-xs font-bold text-white">{initials}</span>
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: assignments } = await supabase
    .from("customer_assignments")
    .select(`
      customer_id,
      role,
      customers (
        id, name, phone, primary_interest, handler_mode, created_at,
        pipeline_stages ( stage )
      )
    `)
    .eq("active", true)
    .order("created_at", { ascending: false });

  const customers = (assignments ?? []).map((a) => a.customers).filter(Boolean);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-slate-900">My Customers</h1>
          <p className="text-sm text-slate-500 mt-0.5">{customers.length} assigned</p>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-600">No customers assigned yet</p>
          <p className="text-xs text-slate-400 mt-1">Customers will appear here once assigned to you.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {customers.map((c: any) => {
            const stage = c.pipeline_stages?.stage ?? "new";
            const stageCfg = STAGE_CONFIG[stage] ?? STAGE_CONFIG.new;
            return (
              <Link
                key={c.id}
                href={`/dashboard/customers/${c.id}`}
                className="group flex items-center gap-3.5 bg-white border border-slate-200 rounded-xl px-4 py-3.5 hover:border-blue-400 hover:shadow-sm transition-all"
              >
                <CustomerAvatar name={c.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-slate-900 truncate">{c.name ?? "Unknown"}</span>
                    <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${stageCfg.color}`}>
                      {stageCfg.label}
                    </span>
                  </div>
                  {c.primary_interest ? (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{c.primary_interest}</p>
                  ) : c.phone ? (
                    <p className="text-xs text-slate-400 mt-0.5">{c.phone}</p>
                  ) : null}
                </div>
                <svg className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
