import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import ConversationThread from "./ConversationThread";
import StageSelect from "./StageSelect";
import AddCollaboratorForm from "./AddCollaboratorForm";
import MuteAlertsToggle from "./MuteAlertsToggle";
import InterestSummary from "./InterestSummary";
import MeetingNotes, { type MeetingNote } from "./MeetingNotes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ id: string }> };

const BAND_CONFIG: Record<string, { label: string; color: string }> = {
  REPEAT: { label: "Repeat Visit", color: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  UNCERTAIN: { label: "Uncertain", color: "bg-amber-50 text-amber-800 border-amber-200" },
  NEW: { label: "New Visitor", color: "bg-slate-100 text-slate-700 border-slate-200" },
};

export default async function CustomerPage({ params }: Props) {
  const { id } = await params;

  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  const isOwner = isOwnerRole(sp);

  const supabase = await createServerSupabaseClient();
  const { data: assignment } = await supabase
    .from("customer_assignments")
    .select("id")
    .eq("customer_id", id)
    .eq("salesperson_id", sp.id)
    .eq("active", true)
    .single();
  if (!assignment && !isOwner) redirect("/dashboard");

  const [
    { data: customer },
    { data: visits },
    { data: messages },
    { data: stageRow },
    { data: meetingNotes },
    teamResult,
    { data: activeSalespersons },
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).single(),
    supabase.from("visits").select("id, match_band, occurred_at, photo_key").eq("customer_id", id).order("occurred_at", { ascending: false }).limit(5),
    supabase.from("messages").select("id, content, direction, sender_type, draft_status, created_at").eq("customer_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("pipeline_stages").select("stage").eq("customer_id", id).single(),
    supabase.from("conversations").select("id, notes, budget, products, stage_at_time, created_at, salespersons(name)").eq("customer_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("customer_assignments").select("id, role, salespersons!salesperson_id(id, name)").eq("customer_id", id).eq("active", true),
    isOwner
      ? supabase.from("salespersons").select("id, name").eq("active", true)
      : Promise.resolve({ data: null }),
  ]);

  if (!customer) notFound();

  const teamRows = teamResult.data ?? [];
  const teamLoadFailed = Boolean(teamResult.error);
  const assignedIds = new Set(teamRows.map((t: any) => t.salespersons?.id).filter(Boolean));
  const addableSalespersons = (activeSalespersons ?? [])
    .filter((s: any) => !assignedIds.has(s.id))
    .map((s: any) => ({ id: s.id as string, name: s.name as string }));

  const currentStage = stageRow?.stage ?? "inquiry";
  const initials = customer.name
    ? customer.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Back Navigation & Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Customers
        </Link>
      </div>

      {/* Hero Header Card */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white flex items-center justify-center font-extrabold text-base shadow-md shadow-blue-500/20 shrink-0">
              {initials}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-medium text-slate-900 tracking-tight truncate">
                  {customer.name ?? "Unknown Customer"}
                </h1>
                <span
                  className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                    customer.handler_mode === "ai"
                      ? "bg-purple-100 text-purple-800 border border-purple-200"
                      : "bg-blue-100 text-blue-800 border border-blue-200"
                  }`}
                >
                  {customer.handler_mode === "ai" ? "AI Assistant Mode" : "Human Salesperson"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500 font-medium">
                {customer.phone && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    {customer.phone}
                  </span>
                )}
                {customer.primary_interest && (
                  <span className="bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded-md text-[11px]">
                    {customer.primary_interest}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <Link
              href="/dashboard/quotes/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-all active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create Quotation
            </Link>
          </div>
        </div>
      </div>

      {/* 2-Column Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Communication & Meeting Notes (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* WhatsApp Communication Panel */}
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col" style={{ height: 540 }}>
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <Link
                href={`/dashboard/customers/${id}/whatsapp`}
                className="flex items-center gap-2 group hover:opacity-80 transition-all"
                title="Open Full WhatsApp View"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider group-hover:text-emerald-700 transition-colors flex items-center gap-1.5">
                  WhatsApp Live Communication
                  <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </h3>
              </Link>
              <div className="flex items-center gap-3">
                {customer.wa_id && (
                  <span className="text-xs font-mono font-semibold text-slate-400">+{customer.wa_id}</span>
                )}
                <Link
                  href={`/dashboard/customers/${id}/whatsapp`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 text-emerald-700 text-[11px] font-bold transition-all shadow-2xs active:scale-95"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z" />
                  </svg>
                  Full WhatsApp Mode
                </Link>
              </div>
            </div>

            <ConversationThread
              customerId={id}
              waId={customer.wa_id ?? null}
              initialMessages={[...(messages ?? [])].reverse() as { id: string; content: string; direction: "outbound" | "inbound"; sender_type: string; draft_status: string | null; created_at: string }[]}
            />
          </div>

          {/* Meeting Notes Log */}
          <div className="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Visit Notes &amp; Meeting Logs</h3>
            <MeetingNotes
              customerId={id}
              initialNotes={(meetingNotes ?? []).map((n: any) => ({
                id: n.id,
                notes: n.notes,
                budget: n.budget,
                products: n.products,
                stage_at_time: n.stage_at_time,
                created_at: n.created_at,
                salespersons: Array.isArray(n.salespersons) ? (n.salespersons[0] ?? null) : n.salespersons,
              })) as MeetingNote[]}
            />
          </div>
        </div>

        {/* Right Column: Pipeline Intelligence Sidebar (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Pipeline Stage Select */}
          <div className="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Pipeline Stage</h3>
            <StageSelect customerId={id} currentStage={currentStage} />
          </div>

          {/* Interest & Preference Summary */}
          <div className="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Interest &amp; Intent Summary</h3>
            <InterestSummary customerId={id} initialSummary={customer.interest_summary ?? null} />
          </div>

          {/* Assigned Representative & Team */}
          <div className="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Assigned Representatives</h3>
            {teamLoadFailed ? (
              <p className="text-xs font-semibold text-rose-600">Failed to load assigned team — refresh the page.</p>
            ) : teamRows.length === 0 ? (
              <p className="text-xs text-slate-400 font-medium">Unclaimed — no salesperson assigned yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-2">
                {teamRows.map((t: any) => (
                  <span
                    key={t.id}
                    className={`text-xs font-bold px-3 py-1 rounded-full border ${
                      t.role === "primary"
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {t.salespersons?.name ?? "Unknown"} · {t.role}
                  </span>
                ))}
              </div>
            )}
            {isOwner && (
              <AddCollaboratorForm customerId={id} options={addableSalespersons} />
            )}
          </div>

          {/* Visit History Log */}
          {(visits ?? []).length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Showroom Visit History</h3>
              <div className="divide-y divide-slate-100">
                {(visits ?? []).map((v) => {
                  const bandCfg = BAND_CONFIG[v.match_band] ?? BAND_CONFIG.NEW;
                  return (
                    <div
                      key={v.id}
                      className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="text-xs font-semibold text-slate-700">
                        {new Date(v.occurred_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${bandCfg.color}`}>
                        {bandCfg.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Owner Arrival Alerts */}
          {isOwner && (
            <div className="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Arrival Alerts</h3>
              <MuteAlertsToggle customerId={id} initialMuted={Boolean(customer.alerts_muted)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
