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
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      {/* Executive Page Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Quotations</h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 font-medium">
            {(quotes ?? []).length} quotation{(quotes ?? []).length === 1 ? "" : "s"} generated
          </p>
        </div>
        <Link
          href="/dashboard/quotes/new"
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-xs font-bold transition-all shadow-xs active:scale-95 shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          + New Quote
        </Link>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-xs font-bold text-rose-700">
          Failed to load quotations — refresh the page.
        </div>
      ) : (quotes ?? []).length === 0 ? (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-12 text-center shadow-xs">
          <p className="text-sm font-bold text-slate-700">No quotations yet</p>
          <p className="mt-1 text-xs text-slate-400">Create one from a customer&apos;s requirements.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">All Quotations</h2>
            <span className="text-xs font-bold text-slate-400">{(quotes ?? []).length} Total</span>
          </div>

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
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 sm:p-4 transition-all hover:border-blue-300 hover:shadow-xs active:scale-[0.99] group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-extrabold text-xs shrink-0 shadow-2xs">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                          {q.quote_no}
                        </span>
                        {q.revision_no > 1 && (
                          <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                            Rev {q.revision_no}
                          </span>
                        )}
                        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${chip.color}`}>
                          {chip.label}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500 font-medium">
                        Customer: <span className="text-slate-800 font-semibold">{customer?.name ?? "Unknown customer"}</span>
                        <span className="text-slate-400"> · Created {formatDate(q.created_at)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs sm:text-sm font-black text-slate-900">{formatINR(q.grand_total)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
