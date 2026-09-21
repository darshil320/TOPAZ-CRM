import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { listSalespersonOptions } from "@/lib/salespersonOptions";
import { describeReadError } from "@/lib/readError";
import { digitsOnly, ilikePattern, MIN_PHONE_DIGITS, normalizeSearchTerm, orFilter } from "@/lib/search";
import PageHeader from "@/components/ui/PageHeader";
import SectionHeader from "@/components/ui/SectionHeader";
import { Card } from "@/components/ui/Card";
import Pagination from "@/components/ui/Pagination";
import AddLeadPanel from "./AddLeadPanel";
import LeadRow, { type LeadRowData } from "./LeadRow";
import { LEAD_STATUSES, statusLabel } from "./status";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ status?: string; q?: string; page?: string; limit?: string }>;
};

export default async function LeadsPage({ searchParams }: Props) {
  const salesperson = await getCurrentSalesperson();
  if (!salesperson) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(params.limit) || 25));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

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
        " status, lost_reason, linked_customer_id, converted_customer_id, created_at, assigned_to," +
      " created_by, follow_ups_remaining, last_contacted_at",
      { count: "exact" },
    );

  const active =
    params.status && (LEAD_STATUSES as readonly string[]).includes(params.status)
      ? params.status
      : null;
  if (active) query = query.eq("status", active);

  // Sanitised through the same helpers orders/quotes already use (lib/search.ts) —
  // this page used to build its own unsafe filter string inline, which both let
  // filter-breaking characters (%, _, comma, parens) through unescaped AND missed
  // any phone typed with a "+" or spaces (the all-digits equality check failed on
  // punctuation, silently falling through to the text branch instead of matching
  // phone_digits at all).
  const term = normalizeSearchTerm(params.q);
  if (term) {
    const digits = digitsOnly(term);
    if (digits.length >= MIN_PHONE_DIGITS) {
      query = query.ilike("phone_digits", `%${digits}%`);
    } else {
      const pattern = ilikePattern(term);
      const filter = pattern
        ? orFilter([`name.ilike.${pattern}`, `society.ilike.${pattern}`, `requirement.ilike.${pattern}`])
        : null;
      if (filter) query = query.or(filter);
    }
  }

  const [result, salespersons] = await Promise.all([
    query.order("created_at", { ascending: false }).range(from, to) as Promise<{
      data: LeadRowData[] | null;
      count: number | null;
      error: unknown;
    }>,
    listSalespersonOptions(supabase),
  ]);
  const { data, count, error } = result;
  const totalCount = count ?? (data ?? []).length;

  const nameById = new Map(salespersons.map((sp) => [sp.id, sp.label]));
  const leads: LeadRowData[] = (data ?? []).map((row) => ({
    ...row,
    assigned_name: row.assigned_to ? nameById.get(row.assigned_to) ?? null : null,
  }));

  const readFailure = error ? describeReadError(error, "leads") : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Leads" subtitle="Capture an enquiry and track it to a sale" />

      <AddLeadPanel salespersons={salespersons} />

      <section className="space-y-3">
        <SectionHeader label={`All leads${active ? ` · ${statusLabel(active)}` : ""}`} total={totalCount} />

        <form className="flex flex-wrap gap-2" action="/dashboard/leads" method="get">
          <input
            type="search"
            name="q"
            defaultValue={term ?? ""}
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
              {term || active
                ? "No leads match this filter."
                : "No leads yet — use New Lead to capture the first one."}
            </p>
          </Card>
        ) : (
          <>
            <div className="space-y-2.5">
              {leads.map((lead) => (
                <LeadRow key={lead.id} lead={lead} />
              ))}
            </div>
            <Pagination page={page} limit={limit} total={totalCount} />
          </>
        )}
      </section>
    </div>
  );
}
