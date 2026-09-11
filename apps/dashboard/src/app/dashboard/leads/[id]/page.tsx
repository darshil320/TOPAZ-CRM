import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import { listSalespersonOptions } from "@/lib/salespersonOptions";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
import { formatDate } from "@/lib/format";
import { followUpLabel, sourceLabel, statusLabel, statusTone } from "../status";
import LeadEditForm from "./LeadEditForm";
import LeadStatusActions from "./LeadStatusActions";
import LeadAudioRecordings from "./LeadAudioRecordings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ id: string }> };

type LeadDetail = {
  id: string;
  name: string | null;
  phone: string;
  society: string | null;
  address: string | null;
  requirement: string | null;
  comments: string | null;
  source: string;
  source_detail: string | null;
  status: string;
  lost_reason: string | null;
  linked_customer_id: string | null;
  converted_customer_id: string | null;
  converted_at: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  follow_ups_remaining: number;
  last_contacted_at: string | null;
};

const SELECT =
  "id, name, phone, society, address, requirement, comments, source, source_detail," +
  " status, lost_reason, linked_customer_id, converted_customer_id, converted_at," +
  " assigned_to, created_by, created_at, updated_at," +
  " follow_ups_remaining, last_contacted_at";

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="text-caption text-t3">{label}</div>
      <div className={`text-body text-t1 ${mono ? "font-mono tabular-nums" : ""}`}>
        {value && value.trim() ? value : "—"}
      </div>
    </div>
  );
}

export default async function LeadPage({ params }: Props) {
  const { id } = await params;

  const salesperson = await getCurrentSalesperson();
  if (!salesperson) redirect("/login");
  const isOwner = isOwnerRole(salesperson);

  const supabase = await createServerSupabaseClient();
  // Same widening cast as the list page: `leads` is absent from the generated Database
  // types until 0046 is pushed and types are regenerated. Drop both casts then.
  const db = supabase as unknown as { from: (table: string) => any };

  // .maybeSingle(), not .single(): .single() errors on zero rows, and behind the `any`
  // cast that error arrives as an unhandled shape rather than a clean notFound().
  const [{ data, error }, salespersons] = await Promise.all([
    db.from("leads").select(SELECT).eq("id", id).maybeSingle() as Promise<{
      data: LeadDetail | null;
      error: unknown;
    }>,
    listSalespersonOptions(supabase),
  ]);

  if (error) throw error;
  if (!data) notFound();
  const lead = data;

  const nameById = new Map(salespersons.map((sp) => [sp.id, sp.label]));
  const assignedName = lead.assigned_to ? nameById.get(lead.assigned_to) ?? null : null;
  const capturedName = lead.created_by ? nameById.get(lead.created_by) ?? null : null;

  // Presentation only — apps/api/src/api/authz.py:assert_can_edit_lead is what enforces
  // this, because RLS does not run on the API's service-role connection.
  const canEdit = isOwner || lead.created_by === salesperson.id;
  const customerId = lead.converted_customer_id ?? lead.linked_customer_id;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-8">
      <div className="space-y-3">
        <Link
          href="/dashboard/leads"
          className="inline-flex items-center gap-1.5 text-caption font-semibold text-t3 hover:text-t1 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Leads
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-title text-t1 font-bold tracking-tight">
                {lead.name || "(no name)"}
              </h1>
              <Pill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Pill>
            </div>
            <p className="text-caption text-t3 mt-1">
              <span className="font-mono tabular-nums text-t2">{lead.phone}</span>
              {" · "}
              {sourceLabel(lead.source)}
              {" · captured "}
              {formatDate(lead.created_at)}
              {capturedName ? ` by ${capturedName}` : ""}
            </p>
            <p className="text-caption text-t3 mt-0.5">
              {followUpLabel(lead.follow_ups_remaining, lead.last_contacted_at)}
            </p>
          </div>

          <LeadStatusActions
            leadId={lead.id}
            status={lead.status}
            convertedCustomerId={lead.converted_customer_id}
            followUpsRemaining={lead.follow_ups_remaining}
          />
        </div>
      </div>

      {lead.status === "lost" && lead.lost_reason && (
        <Card className="border-ln">
          <div className="text-caption text-t3">Lost because</div>
          <div className="text-body text-t1">{lead.lost_reason}</div>
        </Card>
      )}

      <section className="space-y-3">
        <SectionHeader label="Enquiry" />
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Requirement" value={lead.requirement} />
            <Field label="Comments" value={lead.comments} />
            <Field label="Society" value={lead.society} />
            <Field label="Address" value={lead.address} />
            <Field label="Source detail" value={lead.source_detail} />
            <Field label="Assigned to" value={assignedName} />
            <Field label="Captured on" value={formatDate(lead.created_at)} mono />
            <Field label="Last updated" value={formatDate(lead.updated_at)} mono />
          </div>

          {customerId && (
            <div className="mt-4 pt-4 border-t border-ln">
              <Link
                href={`/dashboard/customers/${customerId}`}
                className="text-caption font-semibold text-acc hover:underline"
              >
                {lead.converted_customer_id
                  ? "Open the customer this lead became →"
                  : "This number already belongs to a customer →"}
              </Link>
            </div>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeader label="Call recordings" />
        {/* Playback is open to any viewer (matches leads_select); the upload
            control renders only for canEdit — enforced server-side by the same
            authz.assert_can_edit_lead gate as the edit form above. */}
        <LeadAudioRecordings leadId={lead.id} canEdit={canEdit} />
      </section>

      {canEdit ? (
        <section className="space-y-3">
          <SectionHeader label="Correct this lead" />
          <LeadEditForm lead={lead} salespersons={salespersons} />
        </section>
      ) : (
        <section className="space-y-3">
          <SectionHeader label="Correct this lead" />
          <Card>
            <p className="text-caption text-t2">
              Only {capturedName ? capturedName : "the person who captured this lead"}, or
              the owner, can change these details. You can still move its status and
              convert it.
            </p>
          </Card>
        </section>
      )}
    </div>
  );
}
