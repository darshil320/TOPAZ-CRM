import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import { stateName } from "../states";
import { statusChip } from "../status";
import QuoteActions from "../QuoteActions";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";

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
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-body font-bold text-t1">{quote.quote_no}</h1>
              {quote.revision_no > 1 && (
                <Pill tone="neutral" dot={false}>
                  Rev {quote.revision_no}
                </Pill>
              )}
            </div>
            <p className="mt-1 text-ui text-t2 font-medium">
              {customer?.name ?? "Unknown customer"}
              {customer?.phone && <span className="text-t3 font-mono"> · {customer.phone}</span>}
            </p>
            <p className="mt-0.5 text-caption text-t3 font-mono">
              Created {formatDate(quote.created_at)}
              {creator?.name && ` by ${creator.name}`} · Valid until {formatDate(quote.valid_until)}
            </p>
          </div>
          <Pill tone={quote.status === "approved" ? "pos" : quote.status === "rejected" ? "warn" : "neutral"} dot={false}>
            {chip.label}
          </Pill>
        </div>
      </Card>

      {/* Actions */}
      <Card>
        <QuoteActions quoteId={quote.id} status={quote.status} />
      </Card>

      {/* Revision chain */}
      {(parent || (children ?? []).length > 0) && (
        <Card className="space-y-3">
          <SectionHeader label="Revision History" />
          <div className="space-y-1.5 text-ui">
            {parent && (
              <Link href={`/dashboard/quotes/${parent.id}`} className="block text-acc hover:opacity-80 font-mono font-medium">
                ← Revised from {parent.quote_no} (Rev {parent.revision_no})
              </Link>
            )}
            {(children ?? []).map((c) => (
              <Link key={c.id} href={`/dashboard/quotes/${c.id}`} className="block text-acc hover:opacity-80 font-mono font-medium">
                → Revised to {c.quote_no} (Rev {c.revision_no}) · {statusChip(c.status).label}
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Items */}
      <Card className="overflow-hidden p-0 space-y-0">
        <div className="border-b border-ln px-5 py-3.5 bg-sf2">
          <SectionHeader label="Line Items" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-ui">
            <thead>
              <tr className="border-b border-ln text-left text-caption uppercase font-semibold text-t3 bg-sf2/50">
                <th className="px-5 py-2.5">Description</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-right">Rate</th>
                <th className="px-3 py-2.5 text-right">HSN</th>
                <th className="px-3 py-2.5 text-right">GST%</th>
                <th className="px-5 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ln2">
              {(items ?? []).map((it) => {
                const specs = [it.dimensions, it.material, it.fabric, it.polish, it.customization].filter(Boolean);
                return (
                  <tr key={it.id} className="hover:bg-sf2/40 transition-colors">
                    <td className="px-5 py-3 align-top">
                      <p className="font-semibold text-t1">{it.description}</p>
                      {specs.length > 0 && <p className="mt-0.5 text-caption text-t3">{specs.join(" · ")}</p>}
                    </td>
                    <td className="px-3 py-3 text-right align-top font-mono text-t2">
                      {it.qty}
                      {it.unit ? ` ${it.unit}` : ""}
                    </td>
                    <td className="px-3 py-3 text-right align-top font-mono text-t2">{formatINR(it.unit_price)}</td>
                    <td className="px-3 py-3 text-right align-top font-mono text-t3">{it.hsn}</td>
                    <td className="px-3 py-3 text-right align-top font-mono text-t3">{it.gst_rate}%</td>
                    <td className="px-5 py-3 text-right align-top font-semibold font-mono text-t1">
                      {formatINR(it.line_total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Totals */}
      <Card className="space-y-3">
        <SectionHeader label="Totals" />
        <dl className="ml-auto max-w-xs space-y-1.5 text-ui">
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
          <div className="mt-2 flex items-center justify-between border-t border-ln pt-2">
            <dt className="font-semibold text-t1">Grand total</dt>
            <dd className="text-body font-bold font-mono text-t1">{formatINR(quote.grand_total)}</dd>
          </div>
        </dl>
      </Card>

      {/* Terms + notes */}
      {(quote.terms || quote.notes) && (
        <Card className="space-y-4">
          {quote.terms && (
            <div className="space-y-1">
              <SectionHeader label="Terms & Conditions" />
              <p className="whitespace-pre-wrap text-caption text-t2">{quote.terms}</p>
            </div>
          )}
          {quote.notes && (
            <div className="space-y-1">
              <SectionHeader label="Internal Notes" />
              <p className="whitespace-pre-wrap text-caption text-t3">{quote.notes}</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function TotalRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? "text-t3" : "text-t2"}>{label}</dt>
      <dd className={muted ? "text-t3 font-mono tabular-nums" : "text-t1 font-mono tabular-nums font-semibold"}>{value}</dd>
    </div>
  );
}
