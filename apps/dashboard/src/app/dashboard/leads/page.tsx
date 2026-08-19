import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { listSalespersonOptions } from "@/lib/salespersonOptions";
import { describeReadError } from "@/lib/readError";
import PageHeader from "@/components/ui/PageHeader";
import SectionHeader from "@/components/ui/SectionHeader";
import { Card } from "@/components/ui/Card";
import LeadForm from "./LeadForm";
import LeadRow, { type LeadRowData } from "./LeadRow";
import { LEAD_STATUSES, statusLabel } from "./status";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ status?: string; q?: string }>;
};

const PAGE_SIZE = 100;

export default async function LeadsPage({ searchParams }: Props) {
  const salesperson = await getCurrentSalesperson();
  if (!salesperson) redirect("/login");

  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  // Reads go direct to Supabase under RLS (writes route through FastAPI). The leads
  // select policy is deliberately open to any authenticated salesperson — see 0046.
  //
  // `leads` is not in the generated Database types until 0046 is pushed and the types
  // are regenerated, so the client is widened here rather than each row being cast at
  // the use site — casting per-row silently accepts a GenericStringError as a lead.
  // Regenerate types after deploying the migration and this cast can go.
  const db = supabase as unknown as {
    from: (table: string) => any;
  };

  let query = db
    .from("leads")
    .select(
      "id, name, phone, society, address, requirement, comments, source, source_detail," +
        " status, lost_reason, linked_customer_id, converted_customer_id, created_at, assigned_to",
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const active =
    params.status && (LEAD_STATUSES as readonly string[]).includes(params.status)
      ? params.status
      : null;
  if (active) query = query.eq("status", active);

  const term = (params.q ?? "").trim();
  if (term) {
    const digits = term.replace(/[^0-9]/g, "");
    // A numeric term is a phone lookup; anything else is a text lookup. Running both
    // would make "9426" scan the requirement text too.
    query = digits && digits === term.replace(/\s/g, "")
      ? query.ilike("phone_digits", `%${digits}%`)
      : query.or(`name.ilike.%${term}%,society.ilike.%${term}%,requirement.ilike.%${term}%`);
  }

  const [result, salespersons] = await Promise.all([
    query as Promise<{ data: LeadRowData[] | null; error: unknown }>,
    listSalespersonOptions(supabase),
  ]);
  const { data, error } = result;

  const nameById = new Map(salespersons.map((sp) => [sp.id, sp.label]));
  const leads: LeadRowData[] = (data ?? []).map((row) => ({
    ...row,
    assigned_name: row.assigned_to ? nameById.get(row.assigned_to) ?? null : null,
  }));

  const readFailure = error ? describeReadError(error, "leads") : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Leads" subtitle="Capture an enquiry and track it to a sale" />

      <section className="space-y-3">
        <SectionHeader label="Add a lead" />
        <LeadForm salespersons={salespersons} />
      </section>

      <section className="space-y-3">
        <SectionHeader label={`All leads${active ? ` · ${statusLabel(active)}` : ""}`} total={leads.length} />

        <form className="flex flex-wrap gap-2" action="/dashboard/leads" method="get">
          <input
            type="search"
            name="q"
            defaultValue={term}
            placeholder="Search name, phone, society or requirement"
            aria-label="Search leads"
            className="flex-1 min-w-[220px] rounded-input border border-ln bg-sf px-3 py-2 text-body text-t1 placeholder:text-t3"
          />
          <select
            name="status"
            defaultValue={active ?? ""}
            aria-label="Filter by status"
            className="rounded-input border border-ln bg-sf px-3 py-2 text-body text-t1"
          >
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-input border border-ln px-4 py-2 text-body font-semibold text-t1 hover:text-acc transition-colors"
          >
            Filter
          </button>
        </form>

        {readFailure ? (
          <Card><p className="text-body text-neg">{readFailure.message}</p></Card>
        ) : leads.length === 0 ? (
          <Card>
            <p className="text-body text-t2">
              {term || active ? "No leads match this filter." : "No leads yet — add the first one above."}
            </p>
          </Card>
        ) : (
          <Card>
            {leads.map((lead) => (
              <LeadRow key={lead.id} lead={lead} />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
