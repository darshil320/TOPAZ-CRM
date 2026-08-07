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
import { fulfillmentLabel } from "../../deliveries/types";
import OrderStatusActions from "../OrderStatusActions";
import RecordPaymentForm from "../RecordPaymentForm";
import ReceiptDownloadButton from "./ReceiptDownloadButton";
import ChallanButton from "../../deliveries/ChallanButton";
import OrderProductionPhotos, { ProductionPhoto } from "./OrderProductionPhotos";
import JobCardActions from "@/components/JobCardActions";
import LineItemPhotoCell from "@/components/LineItemPhotoCell";
import { loadLinePhotos } from "@/lib/media/lineItemPhotos";
import RouteModal from "../../production/allocate/RouteModal";
import { listWorkshops } from "@/lib/workshops";
import { listRouteTemplates } from "@/lib/production/reads";
import type { StageDef } from "@/lib/production/types";

// Mirrors api/production.py's own gate: only these roles may plan production.
const ROUTABLE_ROLES = new Set(["owner", "admin", "salesperson"]);

type Props = { params: Promise<{ id: string }> };

/** One production photo row, as the gallery below needs it. */
type GalleryMediaRow = {
  id: string;
  entity_id: string;
  storage_key: string;
  created_at: string;
  stage_code: string | null;
  production_stage_defs?: { label_en: string } | { label_en: string }[] | null;
};

function one<T>(rel: T | T[] | null | undefined): T | null {
  return Array.isArray(rel) ? rel[0] ?? null : rel ?? null;
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params;
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const canRoute = ROUTABLE_ROLES.has(sp.role ?? "");

  // Every read below is keyed on the order id, not on the order ROW — so the
  // header no longer costs a round-trip that the other eight wait behind.
  const [
    { data: order },
    { data: items },
    { data: out },
    { data: schedule },
    { data: payments },
    { data: timeline },
    { data: stageRows },
    { data: deliveries },
    workshopList,
    templateList,
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("*, customers(name, phone), quotations(quote_no)")
      .eq("id", id)
      .single(),
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
    // The order's runs, with what travelled on each (0039) and whether its challan has
    // been generated (0037). One order can have several runs once part-delivery is used.
    //
    // FILTERED THROUGH THE LINES, NOT `deliveries.order_id` (0040): a run can carry items
    // from several orders, so "this order's runs" is "runs with a line off this order".
    //
    // A filter on an `!inner` embed narrows the RETURNED rows too, so `delivery_items` here
    // is exactly this order's share of each run — which is what this page is about. That the
    // lorry also carried somebody else's goods is surfaced from `delivery_consignments`
    // (more than one recipient) rather than by re-embedding the whole line set.
    supabase
      .from("deliveries")
      .select(
        "id, status, scheduled_date, delivered_at, vehicle_no, eway_bill_no," +
          " salespersons(name)," +
          " delivery_consignments(id, customer_id, challan_no, customers(name))," +
          " delivery_items!inner(order_item_id, order_id, received," +
          " order_items(id, description, qty, unit, orders(id, order_no)))",
      )
      .eq("delivery_items.order_id", id)
      .order("scheduled_date", { ascending: false }),
    canRoute ? listWorkshops(false) : Promise.resolve({ workshops: [], error: null }),
    canRoute ? listRouteTemplates(true) : Promise.resolve({ data: null, error: null }),
  ]);

  if (!order) notFound();

  const itemIds = (items ?? []).map((i) => i.id);

  // Both of these need the line items and nothing else, so they run together
  // rather than one behind the other:
  //   - the signed line thumbnails (same precedence the job card prints with)
  //   - the production photo gallery's rows
  const [linePhotos, { data: rawMediaRows }] = await Promise.all([
    loadLinePhotos(
      supabase,
      "order_item",
      (items ?? []).map((it) => ({ id: it.id, product_id: it.product_id })),
    ),
    itemIds.length > 0
      ? supabase
          .from("media")
          // stage_code (0036) is the stage the photo DOCUMENTS. Before it, this page
          // labelled every photo with the item's CURRENT stage — so yesterday's frame-work
          // photo was captioned "Polishing" the moment the item moved on.
          .select(
            "id, entity_id, storage_key, mime, created_at, stage_code," +
              " production_stage_defs(label_en, label_gu)",
          )
          .eq("entity_type", "order_item")
          .in("entity_id", itemIds)
          .eq("status", "ready")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  // The two branches give PostgREST no single literal select string to infer from, so
  // the row shape is stated here instead (same convention as `stages` below).
  const rawMedia = (rawMediaRows ?? []) as unknown as GalleryMediaRow[];

  const stages = (stageRows ?? []) as StageDef[];
  const routeWorkshops = workshopList.workshops
    .filter((w) => w.active)
    .map((w) => ({ id: w.id, name: w.name, type: w.type, openItemCount: w.open_item_count ?? 0 }));
  const todayISO = new Date().toISOString().slice(0, 10);

  const customer = one(order.customers as { name: string | null; phone: string | null } | null);
  const quote = one(order.quotations as { quote_no: string } | null);
  const chip = orderStatusChip(order.status);
  // Goods out the door, separate from the sales pipeline (0040). An order sits at 'ready'
  // while it is part-shipped, so `status` alone cannot say how much has actually gone.
  const fulfilment = fulfillmentLabel(order.fulfillment_status);
  const deliveredCount = (items ?? []).filter((it) => it.delivered_at).length;
  // orders carry no place_of_supply column — intra-state iff no IGST was charged.
  const intra = Number(order.igst) === 0;
  const paid = out?.paid ?? 0;
  const outstanding = out?.outstanding ?? order.grand_total;

  // ONE batched sign for the whole gallery. It used to be `createSignedUrl` inside
  // the loop below — one sequential HTTPS round-trip to Storage per photo, which is
  // what made a well-photographed order the slowest page in the app.
  //
  // Storage reports per-path failures inside a successful batch, so a key that could
  // not be signed is simply absent from the map and its photo is dropped — the same
  // outcome the per-photo version had, without costing the other twenty.
  const photoKeys = Array.from(new Set((rawMedia ?? []).map((m) => m.storage_key)));
  const signedByKey = new Map<string, string>();
  if (photoKeys.length > 0) {
    const { data: signedList } = await supabase.storage
      .from("media")
      .createSignedUrls(photoKeys, 3600);
    for (const row of signedList ?? []) {
      if (row.path && row.signedUrl) signedByKey.set(row.path, row.signedUrl);
    }
  }

  const itemsById = new Map((items ?? []).map((i) => [i.id, i]));

  const orderPhotos: ProductionPhoto[] = [];
  for (const m of rawMedia ?? []) {
    const signedUrl = signedByKey.get(m.storage_key);
    if (!signedUrl) continue;
    const matchingItem = itemsById.get(m.entity_id);
    // The photo's OWN stage when it has one; the item's current stage only as a fallback
    // for photos uploaded before 0036 existed.
    const photoStage = one((m as any).production_stage_defs as { label_en: string } | null);
    const itemStage = one(matchingItem?.production_stage_defs as { label_en: string } | null);
    orderPhotos.push({
      id: m.id,
      orderItemId: m.entity_id,
      itemDescription: matchingItem?.description ?? "Item",
      stageCode: (m as any).stage_code ?? matchingItem?.current_stage ?? null,
      stageLabel:
        photoStage?.label_en ??
        (m as any).stage_code ??
        itemStage?.label_en ??
        matchingItem?.current_stage ??
        null,
      imageUrl: signedUrl,
      createdAt: m.created_at,
    });
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
              <Pill tone={fulfilment.tone} dot={false}>
                {fulfilment.label}
                {(items ?? []).length > 0 && (
                  <span className="ml-1 font-mono tabular-nums">
                    {deliveredCount}/{(items ?? []).length}
                  </span>
                )}
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
          <table className="w-full min-w-[800px] text-left text-body">
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
                      <LineItemPhotoCell
                        entityType="order_item"
                        entityId={it.id}
                        parentId={order.id}
                        photo={linePhotos.get(it.id) ?? null}
                        description={it.description}
                      />

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
              docLabel={order.order_no}
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

      {/* Deliveries & Challans (0037/0039) — one card per run, because a part-delivered
          order has several, each with its own goods and its own challan. */}
      {(deliveries ?? []).length > 0 && (
        <Card className="space-y-4">
          <SectionHeader
            label="Deliveries & Challans"
            total={`${(deliveries ?? []).length} run${(deliveries ?? []).length === 1 ? "" : "s"}`}
          />
          <div className="divide-y divide-ln2 overflow-hidden rounded-card border border-ln bg-sf2">
            {(deliveries ?? []).map((d: any) => {
              const lines = ((d.delivery_items ?? []) as any[])
                .map((line) => one<any>(line.order_items))
                .filter(Boolean);
              const driver = one<{ name: string | null }>(d.salespersons);
              const consignments = (d.delivery_consignments ?? []) as any[];
              // This order's customer is the order's customer — a consignment is
              // per-recipient, so theirs is the one that matches.
              const ownConsignments = consignments.filter(
                (consignment: any) => consignment.customer_id === order.customer_id,
              );
              return (
                <div
                  key={d.id}
                  className="flex flex-wrap items-start justify-between gap-3 bg-sf p-3.5"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums text-caption font-semibold text-t1">
                        {d.scheduled_date}
                      </span>
                      <Pill
                        tone={d.status === "delivered" ? "pos" : d.status === "failed" ? "warn" : "neutral"}
                        dot={false}
                      >
                        {d.status}
                      </Pill>
                      {driver?.name && (
                        <span className="text-caption text-t3">{driver.name}</span>
                      )}
                    </div>
                    <p className="text-caption text-t2">
                      {lines.length === 0
                        ? "Whole order"
                        : lines
                            .map((it: any) => `${it.description} ×${it.qty ?? 1}`)
                            .join(", ")}
                    </p>
                    {/* The same lorry may have carried another customer's goods (0040).
                        Worth saying: it explains a shared vehicle on the paperwork and a
                        second challan number the customer never sees. */}
                    {consignments.length > 1 && (
                      <p className="text-[11px] font-semibold text-t3">
                        Shared run · {consignments.length} recipients
                      </p>
                    )}
                    {(d.vehicle_no || d.eway_bill_no) && (
                      <p className="font-mono text-[11px] text-t3">
                        {d.vehicle_no && `Vehicle ${d.vehicle_no}`}
                        {d.vehicle_no && d.eway_bill_no && " · "}
                        {d.eway_bill_no && `E-Way ${d.eway_bill_no}`}
                      </p>
                    )}
                  </div>
                  {/* One challan per recipient. Only this customer's is shown — the others
                      are not this order's paperwork, and RLS would have filtered them for a
                      salesperson who cannot read that customer anyway. */}
                  <div className="flex flex-col items-end gap-1">
                    {ownConsignments.length === 0 ? (
                      <span className="text-caption text-t3">—</span>
                    ) : (
                      ownConsignments.map((consignment: any) => (
                        <ChallanButton
                          key={consignment.id}
                          consignmentId={consignment.id}
                          orderIds={[id]}
                          challanNo={consignment.challan_no}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
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
