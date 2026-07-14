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

type Props = { params: Promise<{ id: string }> };

const BAND_CONFIG: Record<string, { label: string; color: string }> = {
  REPEAT: { label: "Repeat", color: "bg-green-100 text-green-700 border-green-200" },
  UNCERTAIN: { label: "Uncertain", color: "bg-amber-100 text-amber-700 border-amber-200" },
  NEW: { label: "New", color: "bg-slate-100 text-slate-600 border-slate-200" },
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
    supabase.from("messages").select("id, content, direction, sender_type, draft_status, created_at").eq("customer_id", id).order("created_at", { ascending: true }).limit(30),
    supabase.from("pipeline_stages").select("stage").eq("customer_id", id).single(),
    supabase.from("conversations").select("id, notes, budget, products, stage_at_time, created_at, salespersons(name)").eq("customer_id", id).order("created_at", { ascending: false }).limit(50),
    // customer_assignments has TWO FKs into salespersons (salesperson_id, added_by) —
    // the embed hint disambiguates which one PostgREST should follow. Without it the
    // query errors ("more than one relationship found") and silently returns no data.
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

      {/* What they're looking for — living summary */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">What They&apos;re Looking For</p>
        <InterestSummary customerId={id} initialSummary={customer.interest_summary ?? null} />
      </div>

      {/* Pipeline stage */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Pipeline Stage</p>
        <StageSelect customerId={id} currentStage={currentStage} />
      </div>

      {/* Arrival alerts (owner-only) — mute known regulars: staff, family, etc. */}
      {isOwner && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Arrival Alerts</p>
          <MuteAlertsToggle customerId={id} initialMuted={Boolean(customer.alerts_muted)} />
        </div>
      )}

      {/* Assigned team */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Assigned Team</p>
        {teamLoadFailed ? (
          <p className="text-sm text-red-600">Failed to load assigned team — refresh the page.</p>
        ) : teamRows.length === 0 ? (
          <p className="text-sm text-slate-400">Unclaimed — no salesperson assigned yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2 mb-3">
            {teamRows.map((t: any) => (
              <span
                key={t.id}
                className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                  t.role === "primary"
                    ? "bg-blue-100 text-blue-700 border-blue-200"
                    : "bg-slate-100 text-slate-600 border-slate-200"
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

      {/* Meeting notes — per-visit log */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Meeting Notes</p>
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
