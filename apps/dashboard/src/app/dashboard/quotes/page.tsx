import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import { normalizeSearchTerm, uuidParam } from "@/lib/search";
import { buildQuoteSearchFilter } from "@/lib/listSearch";
import { listSalespersonOptions } from "@/lib/salespersonOptions";
import { statusChip } from "./status";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import ListFilterBar from "@/components/ui/ListFilterBar";
import Pill from "@/components/ui/Pill";

import Pagination from "@/components/ui/Pagination";

type Props = {
  searchParams: Promise<{ page?: string; limit?: string; q?: string; sp?: string }>;
};

/** Quotes list — RLS scopes rows to the caller (owner/accounts see all; a
 * salesperson sees quotes for customers they're assigned to). */
export default async function QuotesPage({ searchParams }: Props) {
  const { page: pageStr, limit: limitStr, q, sp: spParam } = await searchParams;
  const page = Math.max(1, Number(pageStr) || 1);
  const limit = Math.min(100, Math.max(5, Number(limitStr) || 25));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const term = normalizeSearchTerm(q);
  const salespersonId = uuidParam(spParam);
  const isFiltered = term !== null || salespersonId !== null;

  const supabase = await createServerSupabaseClient();

  // The search also spans customers and the order a quote became — resolved to
  // ids first, since PostgREST cannot `or` across an embedded table.
  const searchFilter = term ? await buildQuoteSearchFilter(supabase, term) : null;

  let quotesQuery = supabase
    .from("quotations")
    .select(
      "id, quote_no, status, revision_no, grand_total, created_at, customers(name, phone), salespersons(name)",
      { count: "exact" },
    );

  if (searchFilter) quotesQuery = quotesQuery.or(searchFilter);
  if (salespersonId) quotesQuery = quotesQuery.eq("created_by", salespersonId);

  const [{ data: quotes, count, error }, salespersonOptions] = await Promise.all([
    quotesQuery.order("created_at", { ascending: false }).range(from, to),
    listSalespersonOptions(supabase),
  ]);

  const totalCount = count ?? (quotes ?? []).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      {/* Executive Page Header */}
      <div className="flex items-center justify-between gap-4">
        <PageHeader
          title="Quotations"
          subtitle={
            isFiltered
              ? `${totalCount} matching quotation${totalCount === 1 ? "" : "s"}`
              : `${totalCount} quotation${totalCount === 1 ? "" : "s"} generated`
          }
        />
        <Link href="/dashboard/quotes/new">
          <Button variant="primary">
            + New Quote
          </Button>
        </Link>
      </div>

      <ListFilterBar
        searchPlaceholder="Search quote no, order no, customer name or mobile…"
        options={salespersonOptions}
        allOptionLabel="All salespersons"
      />

      {error ? (
        <Card className="border-warn/50 bg-warn/10 text-warn text-caption font-semibold">
          Failed to load quotations — refresh the page.
        </Card>
      ) : (quotes ?? []).length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-body font-semibold text-t1">
            {isFiltered ? "No quotations match this search" : "No quotations found"}
          </p>
          <p className="mt-1 text-caption text-t3">
            {isFiltered
              ? "Try a different quote number, order number, customer name or mobile number."
              : "Create one from a customer's requirements."}
          </p>
        </Card>
      ) : (
        <div className="bg-sf rounded-card border border-ln p-0 overflow-hidden shadow-sh">
          <div className="px-4 py-3 border-b border-ln">
            <SectionHeader label={isFiltered ? "Matching Quotations" : "All Quotations"} total={totalCount} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-body">
              <thead>
                <tr className="border-b border-ln text-label-sm uppercase text-t3 bg-sf2">
                  <th className="px-4 py-3 font-semibold">Quote No</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Created Date</th>
                  <th className="px-4 py-3 font-semibold">Salesperson</th>
                  <th className="px-4 py-3 font-semibold text-right">Totals</th>
                  <th className="px-4 py-3 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ln2">
                {(quotes ?? []).map((q) => {
                  const chip = statusChip(q.status);
                  const customer = Array.isArray(q.customers) ? q.customers[0] : q.customers;
                  const author = Array.isArray(q.salespersons) ? q.salespersons[0] : q.salespersons;
                  const initials = customer?.name
                    ? customer.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
                    : "QTN";

                  return (
                    <tr key={q.id} className="hover:bg-sf2 transition-colors group">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/quotes/${q.id}`} className="font-bold text-acc font-mono group-hover:underline flex items-center gap-2">
                          <div className="w-7 h-7 rounded bg-acc/10 text-acc flex items-center justify-center font-bold font-mono text-[10px] shrink-0">
                            {initials}
                          </div>
                          {q.quote_no}
                          {q.revision_no > 1 && (
                            <span className="text-[10px] font-mono text-t3 bg-sf3 px-1.5 py-0.5 rounded">
                              v{q.revision_no}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-t1 font-semibold">{customer?.name ?? "Unknown"}</div>
                        {customer?.phone && <div className="text-t3 font-mono text-caption">{customer.phone}</div>}
                      </td>
                      <td className="px-4 py-3 text-caption text-t2 font-mono">
                        {formatDate(q.created_at)}
                      </td>
                      <td className="px-4 py-3 text-caption text-t2 font-medium">
                        {author?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-t1 font-bold font-mono">{formatINR(q.grand_total)}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Pill tone={q.status === "approved" ? "pos" : q.status === "rejected" ? "warn" : "neutral"} dot={false}>
                          {chip.label}
                        </Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-ln bg-sf">
            <Pagination page={page} limit={limit} total={totalCount} />
          </div>
        </div>
      )}
    </div>
  );
}
