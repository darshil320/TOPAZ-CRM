import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import { Card, StatCard, StatCardGrid } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import ListRow from "@/components/ui/ListRow";
import Pill from "@/components/ui/Pill";
import { orderStatusChip } from "../status";
import OrderStatusActions from "../OrderStatusActions";
import RecordPaymentForm from "../RecordPaymentForm";
import ReceiptDownloadButton from "./ReceiptDownloadButton";
import OrderProductionPhotos, { ProductionPhoto } from "./OrderProductionPhotos";
import JobCardActions from "@/components/JobCardActions";
import LineItemPhotoCell from "@/components/LineItemPhotoCell";
import RouteModal from "../../production/allocate/RouteModal";
import { listWorkshops } from "@/lib/workshops";
import { listRouteTemplates } from "@/lib/production/reads";
import type { StageDef } from "@/lib/production/types";

// Mirrors api/production.py's own gate: only these roles may plan production.
const ROUTABLE_ROLES = new Set(["owner", "admin", "salesperson"]);

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

  const canRoute = ROUTABLE_ROLES.has(sp.role ?? "");

  const [
    { data: items },
    { data: out },
    { data: schedule },
    { data: payments },
    { data: timeline },
    { data: stageRows },
    workshopList,
    templateList,
  ] = await Promise.all([
    supabase
      .from("order_items")
      .select("*, workshops(name, type), production_stage_defs(label_en, label_gu)")
      .eq("order_id", id)
      .order("sort", { ascending: true }),
    supabase.from("order_outstanding").select("grand_total, paid, outstanding").eq("order_id", id).single(),
    supabase.from("payment_schedules").select("*").eq("order_id", id).order("due_date", { ascending: true }),
    supabase.from("payments").select("*").eq("order_id", id).order("paid_at", { ascending: false }),
    supabase.from("audit_log").select("action, changed_at, payload").eq("entity", "orders").eq("entity_id", id).order("changed_at", { ascending: false }).limit(20),
    // Only needed to power RouteModal below — skip the round trips for roles that
    // could never open it (accounts/workshop_manager/delivery never see this button).
    canRoute
      ? supabase
          .from("production_stage_defs")
          .select("code, sort, label_en, label_gu, photo_required, active")
          .eq("active", true)
          .order("sort")
      : Promise.resolve({ data: null }),
    canRoute ? listWorkshops(false) : Promise.resolve({ workshops: [], error: null }),
    canRoute ? listRouteTemplates(true) : Promise.resolve({ data: null, error: null }),
  ]);

  const stages = (stageRows ?? []) as StageDef[];
  const routeWorkshops = workshopList.workshops
    .filter((w) => w.active)
    .map((w) => ({ id: w.id, name: w.name, type: w.type, openItemCount: w.open_item_count ?? 0 }));
  const todayISO = new Date().toISOString().slice(0, 10);

  const customer = one(order.customers as { name: string | null; phone: string | null } | null);
  const quote = one(order.quotations as { quote_no: string } | null);
  const chip = orderStatusChip(order.status);
  // orders carry no place_of_supply column — intra-state iff no IGST was charged.
  const intra = Number(order.igst) === 0;
  const paid = out?.paid ?? 0;
  const outstanding = out?.outstanding ?? order.grand_total;

  // Fetch production media photos for this order's items
  const itemIds = (items ?? []).map((i) => i.id);
  const { data: rawMedia } =
    itemIds.length > 0
      ? await supabase
          .from("media")
          .select("id, entity_id, storage_key, mime, created_at")
          .eq("entity_type", "order_item")
          .in("entity_id", itemIds)
          .eq("status", "ready")
          .order("created_at", { ascending: false })
      : { data: [] };

  const orderPhotos: ProductionPhoto[] = [];
  for (const m of rawMedia ?? []) {
    const matchingItem = (items ?? []).find((i) => i.id === m.entity_id);
    const stageObj = one(matchingItem?.production_stage_defs as { label_en: string } | null);
    const { data: signed } = await supabase.storage.from("media").createSignedUrl(m.storage_key, 3600);
    if (signed?.signedUrl) {
      orderPhotos.push({
        id: m.id,
        orderItemId: m.entity_id,
        itemDescription: matchingItem?.description ?? "Item",
        stageCode: matchingItem?.current_stage ?? null,
        stageLabel: stageObj?.label_en ?? matchingItem?.current_stage ?? null,
        imageUrl: signed.signedUrl,
        createdAt: m.created_at,
      });
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      {/* Back Link & Page Header */}
      <div className="space-y-3">
        <Link href="/dashboard/orders" className="inline-flex items-center gap-1.5 text-caption font-semibold text-t3 hover:text-t1 transition-colors">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Orders
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-title text-t1 font-bold tracking-tight">{order.order_no}</h1>
              <Pill tone={order.status === "installed" || order.status === "closed" ? "pos" : order.status === "cancelled" ? "warn" : "neutral"} dot={false}>
                {chip.label}
              </Pill>
            </div>
            <p className="mt-1 text-body text-t2">
              Customer: <span className="text-t1 font-semibold">{customer?.name ?? "Unknown"}</span>
              {customer?.phone && <span className="text-t3 font-mono"> ({customer.phone})</span>}
              <span className="text-t3"> · Created {formatDate(order.created_at)}</span>
              {order.expected_delivery_date && <span className="text-t3"> · Expected Delivery: {formatDate(order.expected_delivery_date)}</span>}
              {quote && (
                <span className="text-t3">
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
      <Card className="space-y-3">
        <SectionHeader label="Order Status Actions" />
        <OrderStatusActions orderId={order.id} status={order.status} />
      </Card>

      {/* Financial Metrics Summary (StatCardGrid) */}
      <StatCardGrid>
        <StatCard label="Order Total" value={formatINR(order.grand_total)} />
        <StatCard label="Total Paid" value={formatINR(paid)} />
        <StatCard label="Outstanding Balance" value={formatINR(outstanding)} />
      </StatCardGrid>

      {/* Invoice Items Card */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-ln flex items-center justify-between">
          <SectionHeader label="Ordered Items & Tax Breakdown" total={`${(items ?? []).length} items`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body">
            <thead>
              <tr className="border-b border-ln text-label-sm uppercase text-t3">
                <th className="px-4 py-2.5 font-semibold">Item Description</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ln2">
              {(items ?? []).map((it) => {
                const specs = [it.dimensions, it.material, it.fabric, it.polish, it.customization].filter(Boolean);
                const workshop = one(it.workshops as { name: string; type: string } | null);
                const stage = one(it.production_stage_defs as { label_en: string; label_gu: string } | null);

                return (
                  <tr key={it.id} className="hover:bg-sf2 transition-colors">
                    <td className="px-4 py-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-t1 text-nav">{it.description}</p>
                      </div>
                      {specs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {specs.map((spc, idx) => (
                            <span key={idx} className="bg-sf3 text-t2 text-[10px] font-medium px-2 py-0.5 rounded-kbd">
                              {spc}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-caption text-t3 font-mono">
                        {it.qty}{it.unit ? ` ${it.unit}` : ""} × {formatINR(it.unit_price)} · HSN {it.hsn} ({it.gst_rate}% GST)
                      </p>
                      <LineItemPhotoCell entityType="order_item" entityId={it.id} parentId={order.id} />

                      {/* Workshop & Production Stage Badge */}
                      <div className="pt-1 flex flex-wrap items-center gap-2">
                        {workshop ? (
                          <div className="inline-flex items-center gap-1.5 text-[11px] bg-sf2 border border-ln px-2.5 py-1 rounded-card shadow-sh flex-wrap">
                            <span className="text-t3 font-medium">Workshop:</span>
                            <span className="text-t1 font-bold">{workshop.name}</span>
                            <span className="text-t3">({workshop.type === "own" ? "Own floor" : "Vendor"})</span>
                            {stage && (
                              <>
                                <span className="text-t3">·</span>
                                <span className="text-t3 font-medium">Stage:</span>
                                <span className="text-pos font-semibold">{stage.label_en}</span>
                              </>
                            )}
                          </div>
                        ) : null}
                        {/* Plan/re-plan a multi-workshop route — and the ONLY place a
                            deadline (with a time) gets set. Shown even when the item
                            already sits at a single workshop from the old plain-
                            allocate path: the API replans forward from wherever the
                            item currently is, it does not require starting fresh. */}
                        {canRoute && it.production_done_at === null && (
                          <RouteModal
                            itemId={it.id}
                            itemDescription={it.description}
                            orderNo={order.order_no}
                            customerName={customer?.name ?? "Customer"}
                            workshops={routeWorkshops}
                            stages={stages}
                            templates={templateList.data?.templates ?? []}
                            todayISO={todayISO}
                          />
                        )}
                        {!workshop && (
                          <Link
                            href="/dashboard/production/allocate"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-warn bg-warnS border border-warn/30 px-2.5 py-1 rounded-card hover:border-warn transition-all shadow-sh"
                          >
                            <span>Unallocated · Tap to allocate to a workshop →</span>
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold font-mono text-t1 align-top">
                      {formatINR(it.line_total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Job card — the money-free spec sheet, for the customer and the workshop.
            "Send to workshop" only shows once something is actually allocated,
            otherwise the API would 409 with nobody to send to. */}
        <div className="px-4 py-3 border-t border-ln bg-sf">
          <SectionHeader label="Job Card" />
          <div className="mt-2">
            <JobCardActions
              source="order"
              entityId={order.id}
              canSendToWorkshop={(items ?? []).some((it) => it.workshop_id)}
            />
          </div>
        </div>

        {/* Production Photo Gallery & WhatsApp Sharing */}
        <div className="px-4 pb-4 bg-sf">
          <OrderProductionPhotos
            customerName={customer?.name ?? "Customer"}
            customerPhone={customer?.phone ?? null}
            orderNo={order.order_no}
            photos={orderPhotos}
          />
        </div>

        {/* Total calculation footer */}
        <div className="border-t border-ln p-4 bg-sf2">
          <dl className="ml-auto max-w-xs space-y-1.5 text-body">
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
            <div className="mt-2 flex justify-between border-t border-ln pt-2 font-semibold text-nav text-t1">
              <dt>Grand Total</dt>
              <dd className="text-acc font-mono">{formatINR(order.grand_total)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      {/* Payment Schedule (if any) */}
      {(schedule ?? []).length > 0 && (
        <Card className="space-y-3">
          <SectionHeader label="Payment Schedule" />
          <div className="divide-y divide-ln2">
            {(schedule ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2.5 text-body first:pt-0 last:pb-0">
                <span className="font-medium text-t2">{s.label ?? "Instalment"} · Due {formatDate(s.due_date)}</span>
                <span className="flex items-center gap-2 font-mono">
                  <span className="font-semibold text-t1">{formatINR(s.amount)}</span>
                  <Pill tone={s.status === "paid" ? "pos" : "warn"} dot={false}>
                    {s.status}
                  </Pill>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recorded Payments & Receipts */}
      <Card className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-ln2 pb-3">
          <div>
            <SectionHeader
              label="Payment History & Receipts"
              total={`${(payments ?? []).length} payment receipt${(payments ?? []).length === 1 ? "" : "s"} issued`}
            />
          </div>
          {order.status !== "cancelled" && (
            <RecordPaymentForm orderId={order.id} defaultDate={new Date().toISOString().slice(0, 10)} />
          )}
        </div>

        {(payments ?? []).length === 0 ? (
          <div className="rounded-card border border-ln bg-sf2 p-6 text-center">
            <p className="text-caption font-semibold text-t2">No payments recorded yet</p>
            <p className="text-caption text-t3 mt-0.5">Record advance or milestone payments above.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(payments ?? []).map((p) => (
              <ListRow
                key={p.id}
                primary={
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{p.receipt_no}</span>
                    <Pill tone={p.kind === "refund" ? "warn" : "pos"} dot={false}>
                      {p.kind}
                    </Pill>
                    <Pill tone="neutral" dot={false}>
                      {p.mode}
                    </Pill>
                  </div>
                }
                secondary={`Paid on ${formatDate(p.paid_at)} ${p.reference ? `· Ref: ${p.reference}` : ""}`}
                trailing={
                  <div className="flex items-center gap-3">
                    <span className={p.kind === "refund" ? "text-warn" : "text-pos"}>
                      {`${p.kind === "refund" ? "− " : "+"}${formatINR(p.amount)}`}
                    </span>
                    <ReceiptDownloadButton paymentId={p.id} />
                  </div>
                }
              />
            ))}
          </div>
        )}
      </Card>

      {/* Audit Log Timeline */}
      {(timeline ?? []).length > 0 && (
        <Card className="space-y-3">
          <SectionHeader label="Order Timeline" />
          <div className="space-y-2.5">
            {(timeline ?? []).map((t, i) => (
              <div key={i} className="flex items-start gap-3 text-caption">
                <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-acc" />
                <div>
                  <span className="font-semibold text-t1">{t.action}</span>
                  <span className="ml-2 text-caption text-t3 font-mono">{formatDate(t.changed_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
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
