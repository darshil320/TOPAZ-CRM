import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import { statusChip } from "./status";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import Pill from "@/components/ui/Pill";

import Pagination from "@/components/ui/Pagination";

type Props = { searchParams: Promise<{ page?: string; limit?: string }> };

/** Quotes list — RLS scopes rows to the caller (owner/accounts see all; a
 * salesperson sees quotes for customers they're assigned to). */
export default async function QuotesPage({ searchParams }: Props) {
  const { page: pageStr, limit: limitStr } = await searchParams;
  const page = Math.max(1, Number(pageStr) || 1);
  const limit = Math.min(100, Math.max(5, Number(limitStr) || 25));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const { data: quotes, count, error } = await supabase
    .from("quotations")
    .select("id, quote_no, status, revision_no, grand_total, created_at, customers(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  const totalCount = count ?? (quotes ?? []).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      {/* Executive Page Header */}
      <div className="flex items-center justify-between gap-4">
        <PageHeader
          title="Quotations"
          subtitle={`${totalCount} quotation${totalCount === 1 ? "" : "s"} generated`}
        />
        <Link href="/dashboard/quotes/new">
          <Button variant="primary">
            + New Quote
          </Button>
        </Link>
      </div>

      {error ? (
        <Card className="border-warn/50 bg-warn/10 text-warn text-caption font-semibold">
          Failed to load quotations — refresh the page.
        </Card>
      ) : (quotes ?? []).length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-body font-semibold text-t1">No quotations found</p>
          <p className="mt-1 text-caption text-t3">Create one from a customer&apos;s requirements.</p>
        </Card>
      ) : (
        <Card className="space-y-4">
          <SectionHeader label="All Quotations" total={totalCount} />

          <div className="space-y-2">
            {(quotes ?? []).map((q) => {
              const chip = statusChip(q.status);
              const customer = Array.isArray(q.customers) ? q.customers[0] : q.customers;
              const initials = customer?.name
                ? customer.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
                : "QTN";

              return (
                <Link
                  key={q.id}
                  href={`/dashboard/quotes/${q.id}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-ln bg-sf2 p-3 sm:p-4 transition-all hover:border-acc/40 active:scale-[0.99] group shadow-sh"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-md bg-acc text-white flex items-center justify-center font-bold font-mono text-xs shrink-0 shadow-sh">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-ui font-bold text-t1 group-hover:text-acc transition-colors truncate">
                          {q.quote_no}
                        </span>
                        {q.revision_no > 1 && (
                          <Pill tone="neutral" dot={false}>
                            Rev {q.revision_no}
                          </Pill>
                        )}
                        <Pill tone={q.status === "approved" ? "pos" : q.status === "rejected" ? "warn" : "neutral"} dot={false}>
                          {chip.label}
                        </Pill>
                      </div>
                      <p className="mt-0.5 truncate text-caption text-t3 font-medium">
                        Customer: <span className="text-t1 font-semibold">{customer?.name ?? "Unknown customer"}</span>
                        <span className="text-t3 font-mono"> · {formatDate(q.created_at)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-ui font-bold font-mono text-t1">{formatINR(q.grand_total)}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <Pagination page={page} limit={limit} total={totalCount} />
        </Card>
      )}
    </div>
  );
}
