import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import { orderStatusChip } from "../status";
import OrderStatusActions from "../OrderStatusActions";
import RecordPaymentForm from "../RecordPaymentForm";

type Props = { params: Promise<{ id: string }> };

function one<T>(rel: T | T[] | null | undefined): T | null {
  return Array.isArray(rel) ? rel[0] ?? null : rel ?? null;
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params;
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const { data: order } = await supabase
    .from("orders")
    .select("*, customers(name, phone), quotations(quote_no)")
    .eq("id", id)
    .single();
  if (!order) notFound();

  const [{ data: items }, { data: out }, { data: schedule }, { data: payments }, { data: timeline }] =
    await Promise.all([
      supabase.from("order_items").select("*").eq("order_id", id).order("sort", { ascending: true }),
      supabase.from("order_outstanding").select("grand_total, paid, outstanding").eq("order_id", id).single(),
      supabase.from("payment_schedules").select("*").eq("order_id", id).order("due_date", { ascending: true }),
      supabase.from("payments").select("*").eq("order_id", id).order("paid_at", { ascending: false }),
      supabase.from("audit_log").select("action, changed_at, payload").eq("entity", "orders").eq("entity_id", id).order("changed_at", { ascending: false }).limit(20),
    ]);

  const customer = one(order.customers as { name: string | null; phone: string | null } | null);
  const quote = one(order.quotations as { quote_no: string } | null);
  const chip = orderStatusChip(order.status);
  // orders carry no place_of_supply column — intra-state iff no IGST was charged.
  const intra = Number(order.igst) === 0;
  const paid = out?.paid ?? 0;
  const outstanding = out?.outstanding ?? order.grand_total;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      {/* Back Link & Uncarded Executive Page Header */}
      <div className="space-y-3">
        <Link href="/dashboard/orders" className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Orders
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">{order.order_no}</h1>
              <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${chip.color}`}>
                {chip.label}
              </span>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 font-medium">
              Customer: <span className="text-slate-800 font-bold">{customer?.name ?? "Unknown"}</span>
              {customer?.phone && <span className="text-slate-400"> ({customer.phone})</span>}
              <span className="text-slate-400"> · Created {formatDate(order.created_at)}</span>
              {order.expected_delivery_date && <span className="text-slate-400"> · Expected Delivery: {formatDate(order.expected_delivery_date)}</span>}
              {quote && (
                <span className="text-slate-400">
                  {" · Source: "}
                  <Link href={`/dashboard/quotes/${order.quotation_id}`} className="text-acc hover:opacity-80 font-mono font-semibold">
                    {quote.quote_no}
                  </Link>
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Order Status & Transition Actions */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-3">
        <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Order Status Actions</h3>
        <OrderStatusActions orderId={order.id} status={order.status} />
      </div>

      {/* Financial Metrics Summary (3-card Grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="rounded-2xl sm:rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-xs space-y-1">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Order Total</p>
          <p className="text-xl sm:text-2xl font-black text-slate-900">{formatINR(order.grand_total)}</p>
        </div>
        <div className="rounded-2xl sm:rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-xs space-y-1">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Total Paid</p>
          <p className="text-xl sm:text-2xl font-black text-emerald-700">{formatINR(paid)}</p>
        </div>
        <div className="rounded-2xl sm:rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-xs space-y-1">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Outstanding Balance
          </p>
          <p className={`text-xl sm:text-2xl font-black ${Number(outstanding) > 0 ? "text-amber-700" : "text-emerald-700"}`}>
            {formatINR(outstanding)}
          </p>
        </div>
      </div>

      {/* Invoice Items Card */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden space-y-0">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Ordered Items &amp; Tax Breakdown</h3>
          <span className="text-xs font-bold text-slate-400">{(items ?? []).length} items</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/40 text-[10px] uppercase font-bold text-slate-400">
                <th className="px-5 py-3">Item Description</th>
                <th className="px-5 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(items ?? []).map((it) => {
                const specs = [it.dimensions, it.material, it.fabric, it.polish, it.customization].filter(Boolean);
                return (
                  <tr key={it.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3.5 space-y-1">
                      <p className="font-bold text-slate-900 text-sm">{it.description}</p>
                      {specs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {specs.map((spc, idx) => (
                            <span key={idx} className="bg-slate-100 text-slate-600 text-[10px] font-semibold px-2 py-0.5 rounded-md">
                              {spc}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-[11px] text-slate-400 font-medium">
                        {it.qty}{it.unit ? ` ${it.unit}` : ""} × {formatINR(it.unit_price)} · HSN {it.hsn} ({it.gst_rate}% GST)
                      </p>
                    </td>
                    <td className="px-5 py-3.5 text-right font-black text-slate-900 text-sm align-top">
                      {formatINR(it.line_total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Total calculation footer */}
        <div className="border-t border-slate-100 bg-slate-50/40 p-5">
          <dl className="ml-auto max-w-xs space-y-1.5 text-xs sm:text-sm">
            <TotalRow label="Subtotal" value={formatINR(order.subtotal)} />
            {Number(order.discount_amount) > 0 && <TotalRow label="Discount" value={`− ${formatINR(order.discount_amount)}`} />}
            <TotalRow label="Taxable Value" value={formatINR(order.taxable_value)} />
            {intra ? (
              <>
                <TotalRow label="CGST" value={formatINR(order.cgst)} muted />
                <TotalRow label="SGST" value={formatINR(order.sgst)} muted />
              </>
            ) : (
              <TotalRow label="IGST" value={formatINR(order.igst)} muted />
            )}
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-black text-sm sm:text-base text-slate-900">
              <dt>Grand Total</dt>
              <dd className="text-blue-600">{formatINR(order.grand_total)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Payment Schedule (if any) */}
      {(schedule ?? []).length > 0 && (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Payment Schedule</h3>
          <div className="divide-y divide-slate-100">
            {(schedule ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2.5 text-xs sm:text-sm first:pt-0 last:pb-0">
                <span className="font-medium text-slate-700">{s.label ?? "Instalment"} · Due {formatDate(s.due_date)}</span>
                <span className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">{formatINR(s.amount)}</span>
                  <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${s.status === "paid" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
                    {s.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recorded Payments & Receipts */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Payment History &amp; Receipts</h3>
            <p className="text-[11px] font-medium text-slate-400 mt-0.5">
              {(payments ?? []).length} payment receipt{(payments ?? []).length === 1 ? "" : "s"} issued
            </p>
          </div>
          {order.status !== "cancelled" && (
            <RecordPaymentForm orderId={order.id} defaultDate={new Date().toISOString().slice(0, 10)} />
          )}
        </div>

        {(payments ?? []).length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-6 text-center">
            <p className="text-xs font-bold text-slate-600">No payments recorded yet</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Record advance or milestone payments above.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {(payments ?? []).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-xs transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs ${
                      p.kind === "refund"
                        ? "bg-rose-50 text-rose-600 border border-rose-100"
                        : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                    }`}
                  >
                    {p.kind === "refund" ? "↩" : "✓"}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-bold text-slate-900">{p.receipt_no}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200/80 text-slate-700 text-[10px] font-extrabold uppercase tracking-wider">
                        {p.kind}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-[10px] font-extrabold uppercase tracking-wider">
                        {p.mode}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium mt-0.5 truncate">
                      Paid on {formatDate(p.paid_at)} {p.reference ? `· Ref: ${p.reference}` : ""}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-xs sm:text-sm font-black ${p.kind === "refund" ? "text-rose-600" : "text-emerald-700"}`}>
                    {p.kind === "refund" ? "− " : "+"}{formatINR(p.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Audit Log Timeline */}
      {(timeline ?? []).length > 0 && (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Order Timeline</h3>
          <div className="space-y-3">
            {(timeline ?? []).map((t, i) => (
              <div key={i} className="flex items-start gap-3 text-xs sm:text-sm">
                <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500 ring-4 ring-blue-50" />
                <div>
                  <span className="font-semibold text-slate-800">{t.action}</span>
                  <span className="ml-2 text-xs text-slate-400 font-medium">{formatDate(t.changed_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" }) {
  const color = tone === "green" ? "text-green-700" : tone === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-card border border-ln bg-sf p-4 shadow-sh">
      <p className="text-label-sm uppercase text-t3">{label}</p>
      <p className={`mt-1 text-base font-bold font-mono tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function TotalRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={muted ? "text-t3" : "text-t2"}>{label}</dt>
      <dd className={muted ? "text-t3 font-mono tabular-nums" : "text-t1 font-mono tabular-nums font-semibold"}>{value}</dd>
    </div>
  );
}
