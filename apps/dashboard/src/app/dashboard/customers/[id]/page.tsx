import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import { buttonVariants } from "@/components/ui/Button";
import Pill from "@/components/ui/Pill";
import ConversationThread from "./ConversationThread";
import StageSelect from "./StageSelect";
import { orderStatusChip } from "../../orders/status";
import { formatINR, formatDate } from "@/lib/format";
import AddCollaboratorForm from "./AddCollaboratorForm";
import MuteAlertsToggle from "./MuteAlertsToggle";
import InterestSummary from "./InterestSummary";
import MeetingNotes, { type MeetingNote } from "./MeetingNotes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ id: string }> };

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
    { data: orders },
    { data: stageRow },
    { data: meetingNotes },
    teamResult,
    { data: activeSalespersons },
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).single(),
    supabase.from("visits").select("id, match_band, occurred_at, photo_key").eq("customer_id", id).order("occurred_at", { ascending: false }).limit(5),
    supabase.from("messages").select("id, content, direction, sender_type, draft_status, created_at").eq("customer_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("orders").select("id, order_no, status, grand_total, created_at").eq("customer_id", id).order("created_at", { ascending: false }).limit(20),
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

  const orderRows = orders ?? [];
  const orderIds = orderRows.map((o: any) => o.id);
  const { data: outstandingRows } = orderIds.length
    ? await supabase.from("order_outstanding").select("order_id, outstanding").in("order_id", orderIds)
    : { data: [] };
  const outstandingByOrder = new Map<string, number>(
    (outstandingRows ?? []).map((r: any) => [r.order_id as string, Number(r.outstanding)]),
  );

  const currentStage = stageRow?.stage ?? "inquiry";

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-8">
      {/* Back Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-caption font-semibold text-t3 hover:text-t1 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Customers
        </Link>
      </div>

      {/* Hero Header Card */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-title font-semibold text-t1 tracking-tight">
                {customer.name ?? "Unknown Customer"}
              </h1>
              <Pill tone={customer.handler_mode === "ai" ? "pos" : "neutral"} dot={false}>
                {customer.handler_mode === "ai" ? "AI Mode" : "Human Salesperson"}
              </Pill>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-caption text-t2 font-medium">
              {customer.phone && (
                <span className="font-mono">{customer.phone}</span>
              )}
              {customer.primary_interest && (
                <span className="bg-sf2 text-t1 font-medium px-2 py-0.5 rounded-kbd text-[11px] border border-ln">
                  {customer.primary_interest}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <Link
              href="/dashboard/quotes/new"
              className={buttonVariants({ variant: "primary" })}
            >
              Create Quotation
            </Link>
          </div>
        </div>
      </Card>

      {/* 2-Column Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Communication & Meeting Notes (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* WhatsApp Communication Panel */}
          <Card className="p-0 overflow-hidden flex flex-col h-[480px] sm:h-[540px]">
            <div className="px-4 py-3 border-b border-ln flex items-center justify-between bg-sf2">
              <Link
                href={`/dashboard/customers/${id}/whatsapp`}
                prefetch={true}
                className="flex items-center gap-2 hover:opacity-80 transition-all min-w-0"
              >
                <span className="w-2 h-2 rounded-full bg-pos animate-pulse shrink-0" />
                <span className="text-section font-semibold text-t1 truncate">WhatsApp Live Communication</span>
              </Link>
              {customer.wa_id && (
                <span className="text-caption font-mono text-t3 truncate">+{customer.wa_id}</span>
              )}
            </div>

            <ConversationThread
              customerId={id}
              waId={customer.wa_id ?? null}
              initialMessages={[...(messages ?? [])].reverse() as { id: string; content: string; direction: "outbound" | "inbound"; sender_type: string; draft_status: string | null; created_at: string }[]}
            />
          </Card>

          {/* Meeting Notes Log */}
          <Card className="space-y-3">
            <SectionHeader label="Visit Notes & Meeting Logs" />
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
          </Card>
        </div>

        {/* Right Column: Pipeline Intelligence Sidebar (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Pipeline Stage Select */}
          <Card className="space-y-3">
            <SectionHeader label="Pipeline Stage" />
            <StageSelect customerId={id} currentStage={currentStage} />
          </Card>

          {/* Orders & Production Status */}
          {orderRows.length > 0 && (
            <Card className="space-y-3">
              <SectionHeader label="Orders & Production" />
              <div className="divide-y divide-ln2">
                {orderRows.map((o: any) => {
                  const chip = orderStatusChip(o.status);
                  const outstanding = outstandingByOrder.get(o.id);
                  return (
                    <Link
                      key={o.id}
                      href={`/dashboard/orders/${o.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 hover:opacity-80 transition-opacity"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-ui font-semibold font-mono text-t1 truncate">{o.order_no}</span>
                          <Pill tone={o.status === "installed" || o.status === "closed" ? "pos" : "neutral"} dot={false}>
                            {chip.label}
                          </Pill>
                        </div>
                        <span className="text-caption text-t3 font-mono">
                          {formatDate(o.created_at)} · {formatINR(o.grand_total)}
                        </span>
                      </div>
                      {outstanding !== undefined && (
                        <Pill tone={outstanding > 0 ? "warn" : "pos"} dot={false}>
                          {outstanding > 0 ? `${formatINR(outstanding)} due` : "Paid"}
                        </Pill>
                      )}
                    </Link>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Interest & Preference Summary */}
          <Card className="space-y-3">
            <SectionHeader label="Interest & Intent Summary" />
            <InterestSummary customerId={id} initialSummary={customer.interest_summary ?? null} />
          </Card>

          {/* Assigned Representative & Team */}
          <Card className="space-y-3">
            <SectionHeader label="Assigned Representatives" />
            {teamLoadFailed ? (
              <p className="text-caption text-warn">Failed to load assigned team — refresh the page.</p>
            ) : teamRows.length === 0 ? (
              <p className="text-caption text-t3">Unclaimed — no salesperson assigned yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {teamRows.map((t: any) => (
                  <Pill key={t.id} tone={t.role === "primary" ? "pos" : "neutral"} dot={false}>
                    {t.salespersons?.name ?? "Unknown"} · {t.role}
                  </Pill>
                ))}
              </div>
            )}
            {isOwner && (
              <AddCollaboratorForm customerId={id} options={addableSalespersons} />
            )}
          </Card>

          {/* Visit History Log */}
          {(visits ?? []).length > 0 && (
            <Card className="space-y-3">
              <SectionHeader label="Showroom Visit History" />
              <div className="divide-y divide-ln2">
                {(visits ?? []).map((v) => (
                  <div key={v.id} className="flex items-center justify-between py-2 text-caption first:pt-0 last:pb-0">
                    <span className="font-mono text-t2">{formatDate(v.occurred_at)}</span>
                    <Pill tone="neutral" dot={false}>
                      {v.match_band}
                    </Pill>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Owner Arrival Alerts */}
          {isOwner && (
            <Card className="space-y-3">
              <SectionHeader label="Arrival Alerts" />
              <MuteAlertsToggle customerId={id} initialMuted={Boolean(customer.alerts_muted)} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
