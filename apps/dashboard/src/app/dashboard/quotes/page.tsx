import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import { statusChip } from "./status";

/** Quotes list — RLS scopes rows to the caller (owner/accounts see all; a
 * salesperson sees quotes for customers they're assigned to). */
export default async function QuotesPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const { data: quotes, error } = await supabase
    .from("quotations")
    .select("id, quote_no, status, revision_no, grand_total, created_at, customers(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Quotations</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {(quotes ?? []).length} quotation{(quotes ?? []).length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/dashboard/quotes/new"
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          + New quote
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load quotations — refresh the page.
        </div>
      ) : (quotes ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm font-medium text-slate-600">No quotations yet</p>
          <p className="mt-1 text-xs text-slate-400">Create one from a customer&apos;s requirements.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(quotes ?? []).map((q) => {
            const chip = statusChip(q.status);
            const customer = Array.isArray(q.customers) ? q.customers[0] : q.customers;
            return (
              <Link
                key={q.id}
                href={`/dashboard/quotes/${q.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:border-slate-300"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{q.quote_no}</span>
                    {q.revision_no > 1 && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                        Rev {q.revision_no}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {customer?.name ?? "Unknown customer"} · {formatDate(q.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold text-slate-900">{formatINR(q.grand_total)}</span>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${chip.color}`}>
                    {chip.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
