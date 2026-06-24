import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ConversationThread from "./ConversationThread";
import StageSelect from "./StageSelect";

type Props = { params: Promise<{ id: string }> };

const BAND_CONFIG: Record<string, { label: string; color: string }> = {
  REPEAT: { label: "Repeat", color: "bg-green-100 text-green-700 border-green-200" },
  UNCERTAIN: { label: "Uncertain", color: "bg-amber-100 text-amber-700 border-amber-200" },
  NEW: { label: "New", color: "bg-slate-100 text-slate-600 border-slate-200" },
};

export default async function CustomerPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sp } = await supabase
    .from("salespersons")
    .select("id")
    .eq("auth_uid", user.id)
    .eq("active", true)
    .single();
  if (!sp) redirect("/login");

  const { data: assignment } = await supabase
    .from("customer_assignments")
    .select("id")
    .eq("customer_id", id)
    .eq("salesperson_id", sp.id)
    .eq("active", true)
    .single();
  if (!assignment) redirect("/dashboard");

  const [
    { data: customer },
    { data: visits },
    { data: messages },
    { data: stageRow },
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).single(),
    supabase.from("visits").select("id, match_band, occurred_at, photo_key").eq("customer_id", id).order("occurred_at", { ascending: false }).limit(5),
    supabase.from("messages").select("id, content, direction, sender_type, draft_status, created_at").eq("customer_id", id).order("created_at", { ascending: true }).limit(30),
    supabase.from("pipeline_stages").select("stage").eq("customer_id", id).single(),
  ]);

  if (!customer) notFound();

  const currentStage = stageRow?.stage ?? "new";
  const initials = customer.name
    ? customer.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <div className="space-y-4">
      {/* Back + breadcrumb */}
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Customers
        </Link>
      </div>

      {/* Customer header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0 shadow-md">
            <span className="text-sm font-bold text-white">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-base font-bold text-slate-900">{customer.name ?? "Unknown"}</h1>
                {customer.phone && (
                  <p className="text-sm text-slate-500 mt-0.5">{customer.phone}</p>
                )}
                {customer.primary_interest && (
                  <p className="text-xs text-slate-400 mt-1">{customer.primary_interest}</p>
                )}
              </div>
              <span
                className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${
                  customer.handler_mode === "ai"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {customer.handler_mode === "ai" ? "AI" : "Human"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline stage */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Pipeline Stage</p>
        <StageSelect customerId={id} currentStage={currentStage} />
      </div>

      {/* Visit history */}
      {(visits ?? []).length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Visit History</p>
          <div className="space-y-2">
            {(visits ?? []).map((v) => {
              const bandCfg = BAND_CONFIG[v.match_band] ?? BAND_CONFIG.NEW;
              return (
                <div
                  key={v.id}
                  className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0 last:pb-0"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                    <span className="text-sm text-slate-700">
                      {new Date(v.occurred_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${bandCfg.color}`}>
                      {bandCfg.label}
                    </span>
                    {v.photo_key && (
                      <span className="text-xs text-blue-500 font-medium">Photo</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Conversation */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ height: 520 }}>
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">WhatsApp</p>
          {customer.wa_id && (
            <span className="ml-auto text-xs text-slate-400">{customer.wa_id}</span>
          )}
        </div>
        <ConversationThread
          customerId={id}
          waId={customer.wa_id ?? null}
          initialMessages={(messages ?? []) as { id: string; content: string; direction: "outbound" | "inbound"; sender_type: string; draft_status: string | null; created_at: string }[]}
        />
      </div>
    </div>
  );
}
