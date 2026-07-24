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
    <div className="space-y-4">
      <Link href="/dashboard/orders" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Orders
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-900">{order.order_no}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {customer?.name ?? "Unknown"}
              {customer?.phone && <span className="text-slate-400"> · {customer.phone}</span>}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Created {formatDate(order.created_at)}
              {order.expected_delivery_date && ` · Expected ${formatDate(order.expected_delivery_date)}`}
              {quote && (
                <>
                  {" · from "}
                  <Link href={`/dashboard/quotes/${order.quotation_id}`} className="text-blue-600 hover:underline">
                    {quote.quote_no}
                  </Link>
                </>
              )}
            </p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${chip.color}`}>{chip.label}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Status</p>
        <OrderStatusActions orderId={order.id} status={order.status} />
      </div>

      {/* Outstanding */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Order total" value={formatINR(order.grand_total)} />
        <Stat label="Paid" value={formatINR(paid)} tone="green" />
        <Stat label="Outstanding" value={formatINR(outstanding)} tone={Number(outstanding) > 0 ? "amber" : "green"} />
      </div>

      {/* Items */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Items</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {(items ?? []).map((it) => {
                const specs = [it.dimensions, it.material, it.fabric, it.polish, it.customization].filter(Boolean);
                return (
                  <tr key={it.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{it.description}</p>
                      {specs.length > 0 && <p className="mt-0.5 text-xs text-slate-400">{specs.join(" · ")}</p>}
                      <p className="mt-0.5 text-xs text-slate-400">
                        {it.qty}{it.unit ? ` ${it.unit}` : ""} × {formatINR(it.unit_price)} · HSN {it.hsn} · {it.gst_rate}%
                      </p>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800">{formatINR(it.line_total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-5 py-3">
          <dl className="ml-auto max-w-xs space-y-1 text-sm">
            <TotalRow label="Subtotal" value={formatINR(order.subtotal)} />
            {Number(order.discount_amount) > 0 && <TotalRow label="Discount" value={`− ${formatINR(order.discount_amount)}`} />}
            <TotalRow label="Taxable" value={formatINR(order.taxable_value)} />
            {intra ? (
              <>
                <TotalRow label="CGST" value={formatINR(order.cgst)} muted />
                <TotalRow label="SGST" value={formatINR(order.sgst)} muted />
              </>
            ) : (
              <TotalRow label="IGST" value={formatINR(order.igst)} muted />
            )}
            <div className="mt-1 flex justify-between border-t border-slate-100 pt-1 font-bold text-slate-900">
              <dt>Grand total</dt>
              <dd>{formatINR(order.grand_total)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Payment schedule (read-only here; recording lives in the Payments module) */}
      {(schedule ?? []).length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Payment Schedule</p>
          <div className="space-y-1.5">
            {(schedule ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{s.label ?? "Instalment"} · due {formatDate(s.due_date)}</span>
                <span className="flex items-center gap-2">
                  <span className="text-slate-800">{formatINR(s.amount)}</span>
                  <span className="text-[11px] uppercase text-slate-400">{s.status}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recorded payments + record form */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Payments</p>
          {order.status !== "cancelled" && (
            <RecordPaymentForm orderId={order.id} defaultDate={new Date().toISOString().slice(0, 10)} />
          )}
        </div>
        {(payments ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">No payments recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {(payments ?? []).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  {p.receipt_no} · {p.kind} · {p.mode} · {formatDate(p.paid_at)}
                </span>
                <span className={p.kind === "refund" ? "text-red-600" : "text-slate-800"}>
                  {p.kind === "refund" ? "− " : ""}{formatINR(p.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      {(timeline ?? []).length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Timeline</p>
          <div className="space-y-2">
            {(timeline ?? []).map((t, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                <div>
                  <span className="text-slate-700">{t.action}</span>
                  <span className="ml-2 text-xs text-slate-400">{formatDate(t.changed_at)}</span>
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-1 text-base font-bold ${color}`}>{value}</p>
    </div>
  );
}

function TotalRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={muted ? "text-slate-400" : "text-slate-500"}>{label}</dt>
      <dd className={muted ? "text-slate-500" : "text-slate-700"}>{value}</dd>
    </div>
  );
}
