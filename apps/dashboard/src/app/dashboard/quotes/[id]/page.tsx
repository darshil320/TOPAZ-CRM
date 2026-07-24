import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import { stateName } from "../states";
import { statusChip } from "../status";
import QuoteActions from "../QuoteActions";

type Props = { params: Promise<{ id: string }> };

const HOME_STATE = process.env.HOME_STATE ?? "GJ";

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

export default async function QuoteDetailPage({ params }: Props) {
  const { id } = await params;
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const { data: quote } = await supabase
    .from("quotations")
    .select("*, customers(name, phone), salespersons(name)")
    .eq("id", id)
    .single();

  if (!quote) notFound();

  const [{ data: items }, { data: children }, parentResult] = await Promise.all([
    supabase
      .from("quotation_items")
      .select("*")
      .eq("quotation_id", id)
      .order("sort", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("quotations")
      .select("id, quote_no, revision_no, status")
      .eq("revision_of", id)
      .order("revision_no", { ascending: true }),
    quote.revision_of
      ? supabase.from("quotations").select("id, quote_no, revision_no").eq("id", quote.revision_of).single()
      : Promise.resolve({ data: null }),
  ]);

  const customer = one(quote.customers as { name: string | null; phone: string | null } | null);
  const creator = one(quote.salespersons as { name: string | null } | null);
  const parent = parentResult.data as { id: string; quote_no: string; revision_no: number } | null;
  const chip = statusChip(quote.status);
  const intra = quote.place_of_supply === HOME_STATE;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/quotes"
          className="flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-700"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Quotations
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900">{quote.quote_no}</h1>
              {quote.revision_no > 1 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  Rev {quote.revision_no}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {customer?.name ?? "Unknown customer"}
              {customer?.phone && <span className="text-slate-400"> · {customer.phone}</span>}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Created {formatDate(quote.created_at)}
              {creator?.name && ` by ${creator.name}`} · Valid until {formatDate(quote.valid_until)}
            </p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${chip.color}`}>
            {chip.label}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <QuoteActions quoteId={quote.id} status={quote.status} />
      </div>

      {/* Revision chain */}
      {(parent || (children ?? []).length > 0) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Revision History</p>
          <div className="space-y-1.5 text-sm">
            {parent && (
              <Link href={`/dashboard/quotes/${parent.id}`} className="block text-blue-600 hover:underline">
                ← Revised from {parent.quote_no} (Rev {parent.revision_no})
              </Link>
            )}
            {(children ?? []).map((c) => (
              <Link key={c.id} href={`/dashboard/quotes/${c.id}`} className="block text-blue-600 hover:underline">
                → Revised to {c.quote_no} (Rev {c.revision_no}) · {statusChip(c.status).label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Items */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Line Items</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2.5 font-semibold">Description</th>
                <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                <th className="px-3 py-2.5 text-right font-semibold">Rate</th>
                <th className="px-3 py-2.5 text-right font-semibold">HSN</th>
                <th className="px-3 py-2.5 text-right font-semibold">GST%</th>
                <th className="px-5 py-2.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((it) => {
                const specs = [it.dimensions, it.material, it.fabric, it.polish, it.customization].filter(Boolean);
                return (
                  <tr key={it.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3 align-top">
                      <p className="font-medium text-slate-800">{it.description}</p>
                      {specs.length > 0 && <p className="mt-0.5 text-xs text-slate-400">{specs.join(" · ")}</p>}
                    </td>
                    <td className="px-3 py-3 text-right align-top text-slate-600">
                      {it.qty}
                      {it.unit ? ` ${it.unit}` : ""}
                    </td>
                    <td className="px-3 py-3 text-right align-top text-slate-600">{formatINR(it.unit_price)}</td>
                    <td className="px-3 py-3 text-right align-top text-slate-500">{it.hsn}</td>
                    <td className="px-3 py-3 text-right align-top text-slate-500">{it.gst_rate}%</td>
                    <td className="px-5 py-3 text-right align-top font-medium text-slate-800">
                      {formatINR(it.line_total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totals */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Totals</p>
        <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
          <TotalRow label="Subtotal" value={formatINR(quote.subtotal)} />
          {Number(quote.discount_amount) > 0 && (
            <TotalRow label="Discount" value={`− ${formatINR(quote.discount_amount)}`} />
          )}
          <TotalRow label={`Taxable value (${stateName(quote.place_of_supply)})`} value={formatINR(quote.taxable_value)} />
          {intra ? (
            <>
              <TotalRow label="CGST" value={formatINR(quote.cgst)} muted />
              <TotalRow label="SGST" value={formatINR(quote.sgst)} muted />
            </>
          ) : (
            <TotalRow label="IGST" value={formatINR(quote.igst)} muted />
          )}
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <dt className="font-semibold text-slate-900">Grand total</dt>
            <dd className="text-base font-bold text-slate-900">{formatINR(quote.grand_total)}</dd>
          </div>
        </dl>
      </div>

      {/* Terms + notes */}
      {(quote.terms || quote.notes) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {quote.terms && (
            <>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Terms &amp; Conditions</p>
              <p className="whitespace-pre-wrap text-sm text-slate-600">{quote.terms}</p>
            </>
          )}
          {quote.notes && (
            <>
              <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Internal Notes</p>
              <p className="whitespace-pre-wrap text-sm text-slate-500">{quote.notes}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TotalRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? "text-slate-400" : "text-slate-500"}>{label}</dt>
      <dd className={muted ? "text-slate-500" : "text-slate-700"}>{value}</dd>
    </div>
  );
}
