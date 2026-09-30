import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { listSalespersonOptions } from "@/lib/salespersonOptions";
import { describeReadError } from "@/lib/readError";
import { digitsOnly, ilikePattern, MIN_PHONE_DIGITS, normalizeSearchTerm, orFilter } from "@/lib/search";
import { addDaysISO, todayISO } from "@/lib/format";
import PageHeader from "@/components/ui/PageHeader";
import SectionHeader from "@/components/ui/SectionHeader";
import { Card } from "@/components/ui/Card";
import Pagination from "@/components/ui/Pagination";
import AddLeadPanel from "./AddLeadPanel";
import LeadRow, { type LeadRowData } from "./LeadRow";
import { LEAD_STATUSES, statusLabel } from "./status";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    status?: string;
    q?: string;
    page?: string;
    limit?: string;
    dateFrom?: string;
    dateTo?: string;
    followUp?: string;
  }>;
};

const FOLLOW_UP_FILTERS = ["overdue", "today", "week", "none"] as const;
type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number];

const FOLLOW_UP_LABELS: Record<FollowUpFilter, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week",
  none: "No follow-up set",
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A validated YYYY-MM-DD from a query-string value, or null. Same shape as
 * lib/search.ts's other query-param validators — reject silently rather than
 * pass a malformed string into a Postgres timestamp comparison. */
function dateParam(raw: string | undefined): string | null {
  return raw && ISO_DATE_RE.test(raw) ? raw : null;
}

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
      " created_by, followup_due_on",
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

  // Date filter on created_at — a single date (dateFrom only) means "that whole
  // day"; a range is inclusive of both ends. The "day" is the SHOWROOM's calendar
  // day (IST, +05:30), not UTC — an explicit offset on the boundary timestamps,
  // not a bare "T00:00:00" (which Postgres/PostgREST would read as UTC and cut
  // off the first 5.5 hours of the actual local day). The upper bound is the
  // START of the NEXT local day (< dateTo+1) rather than <= dateTo, which would
  // silently exclude every lead captured later that same day.
  const dateFrom = dateParam(params.dateFrom);
  const dateToParam = dateParam(params.dateTo);
  const dateTo = dateToParam ?? (dateFrom && !dateToParam ? dateFrom : null);
  if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00+05:30`);
  if (dateTo) {
    const next = new Date(`${dateTo}T00:00:00+05:30`);
    next.setUTCDate(next.getUTCDate() + 1);
    query = query.lt("created_at", `${next.toISOString().slice(0, 10)}T00:00:00+05:30`);
  }

  // Follow-up filter — same IST-aware todayISO() this page's date-range filter
  // already uses (not a bare `new Date()`, which would misread the showroom's
  // calendar day — see the comment above). followup_due_on is a plain `date`
  // column (not timestamptz), so simple string comparison against todayISO() is
  // exact, no time-of-day boundary math needed the way created_at required above.
  const followUpFilter: FollowUpFilter | null =
    (FOLLOW_UP_FILTERS as readonly string[]).includes(params.followUp ?? "")
      ? (params.followUp as FollowUpFilter)
      : null;
  if (followUpFilter === "overdue") {
    query = query.lt("followup_due_on", todayISO());
  } else if (followUpFilter === "today") {
    query = query.eq("followup_due_on", todayISO());
  } else if (followUpFilter === "week") {
    query = query.gte("followup_due_on", todayISO()).lte("followup_due_on", addDaysISO(todayISO(), 6));
  } else if (followUpFilter === "none") {
    query = query.is("followup_due_on", null).neq("status", "converted").neq("status", "lost");
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
          <select
            name="followUp"
            defaultValue={followUpFilter ?? ""}
            aria-label="Filter by follow-up status"
            className="rounded-input border border-ln bg-sf px-3 py-2 text-body text-t1"
          >
            <option value="">Any follow-up</option>
            {FOLLOW_UP_FILTERS.map((f) => (
              <option key={f} value={f}>{FOLLOW_UP_LABELS[f]}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <label htmlFor="dateFrom" className="sr-only">From date</label>
            <input
              id="dateFrom"
              type="date"
              name="dateFrom"
              defaultValue={dateFrom ?? ""}
              max={dateToParam ?? undefined}
              aria-label="From date"
              className="rounded-input border border-ln bg-sf px-3 py-2 text-body text-t1"
            />
            <span className="text-caption text-t3">to</span>
            <label htmlFor="dateTo" className="sr-only">To date</label>
            <input
              id="dateTo"
              type="date"
              name="dateTo"
              defaultValue={dateToParam ?? ""}
              min={dateFrom ?? undefined}
              aria-label="To date"
              className="rounded-input border border-ln bg-sf px-3 py-2 text-body text-t1"
            />
          </div>
          <button
            type="submit"
            className="rounded-input border border-ln px-4 py-2 text-body font-semibold text-t1 hover:text-acc transition-colors"
          >
            Filter
          </button>
          {(dateFrom || dateToParam || term || active || followUpFilter) && (
            <a
              href="/dashboard/leads"
              className="rounded-input px-4 py-2 text-body font-medium text-t3 hover:text-t1 transition-colors"
            >
              Clear
            </a>
          )}
        </form>

        {readFailure ? (
          <Card><p className="text-body text-neg">{readFailure.message}</p></Card>
        ) : leads.length === 0 ? (
          <Card>
            <p className="text-body text-t2">
              {term || active || dateFrom || dateToParam || followUpFilter
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
