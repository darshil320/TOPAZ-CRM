"use client";

/**
 * The dispatch board and the "schedule a run" modal.
 *
 * ─── THE MODAL IS A BASKET, NOT AN ORDER FORM (0040) ──────────────────────────
 * The client's ask: the Central Table off ORD-1 and the Sofa off ORD-2 are both finished, so
 * send them on one lorry. That makes the order picker a BROWSER, not the subject of the
 * form — switching orders adds to the basket instead of replacing it. Everything downstream
 * (which challans exist, which addresses are needed) is derived from what is in the basket,
 * because deriving it is the only way it cannot disagree with what actually ships.
 */

import { useMemo, useState, useTransition, useOptimistic } from "react";
import Link from "next/link";
import { Truck, Plus, Search, X, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
import SearchableSelect, { type SelectOption } from "@/components/ui/SearchableSelect";
import { haystack, matchesQuery } from "@/lib/textFilter";
import ChallanButton from "./ChallanButton";
import { scheduleDeliveryAction } from "./actions";
import type {
  BasketLine,
  ConsignmentDraft,
  DeliveryRow,
  ReadyOrderRow,
  StaffRow,
} from "./types";
import {
  customerOf,
  driverOf,
  ineligibleReason,
  itemsOf,
  ordersOf,
  recipientsOf,
} from "./types";

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "scheduled", label: "Scheduled" },
  { id: "in_transit", label: "In transit" },
  { id: "delivered", label: "Delivered" },
  { id: "failed", label: "Failed" },
] as const;

const emptyDraft = (customerId: string, customerName: string): ConsignmentDraft => ({
  customerId,
  customerName,
  deliveryAddress: "",
  deliveryRent: "",
  dpCode: "",
});

export default function DeliveriesManagementClient({
  deliveries,
  readyOrders,
  staff,
}: {
  deliveries: DeliveryRow[];
  readyOrders: ReadyOrderRow[];
  staff: StaffRow[];
}) {
  const [showModal, setShowModal] = useState(false);
  /** Which order the picker is currently BROWSING. Not the subject of the form. */
  const [browsingOrderId, setBrowsingOrderId] = useState("");
  /** The goods going on this run, from any number of orders (0040). Keyed by item id. */
  const [basket, setBasket] = useState<Record<string, BasketLine>>({});
  /** Per-recipient challan fields, kept by customer id so they survive basket edits. */
  const [drafts, setDrafts] = useState<Record<string, ConsignmentDraft>>({});
  const [driverId, setDriverId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [vehicleNo, setVehicleNo] = useState("");
  const [ewayBillNo, setEwayBillNo] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [optimisticDeliveries, addOptimisticDelivery] = useOptimistic(
    deliveries,
    (state, newRow: DeliveryRow) => [newRow, ...state]
  );

  /* ── The board ────────────────────────────────────────────────────────────── */

  /** Orders that already have a run on the board — flagged, not hidden: a
   * re-delivery after a failed attempt is legitimate, and with part-delivery a SECOND run
   * for the same order is now the normal case rather than a mistake. */
  const openOrderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const delivery of optimisticDeliveries) {
      if (delivery.status === "failed" || delivery.status === "delivered") continue;
      for (const line of delivery.delivery_items ?? []) {
        if (line.order_id) ids.add(line.order_id);
      }
    }
    return ids;
  }, [optimisticDeliveries]);

  /** Items already committed to an OPEN run, from the board we are looking at.
   *  Mirrors the DB's `delivery_items_one_open` so the greyed reason in the picker and
   *  the eventual unique-violation cannot disagree. A `failed` run releases its items —
   *  rescheduling them is exactly why a run gets marked failed. */
  const openItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const delivery of optimisticDeliveries) {
      if (delivery.status !== "scheduled" && delivery.status !== "in_transit") continue;
      for (const item of itemsOf(delivery)) ids.add(item.id);
    }
    return ids;
  }, [optimisticDeliveries]);

  /* ── The basket ───────────────────────────────────────────────────────────── */

  const basketLines = useMemo(() => Object.values(basket), [basket]);

  /** Grouped for display: a manager loading a lorry thinks in orders, not in line ids. */
  const basketByOrder = useMemo(() => {
    const groups = new Map<string, { orderNo: string; customerName: string; lines: BasketLine[] }>();
    for (const line of basketLines) {
      const group = groups.get(line.orderId) ?? {
        orderNo: line.orderNo,
        customerName: line.customerName,
        lines: [],
      };
      group.lines.push(line);
      groups.set(line.orderId, group);
    }
    return [...groups.entries()].map(([orderId, group]) => ({ orderId, ...group }));
  }, [basketLines]);

  /** One challan per distinct recipient — derived, exactly as the DB derives it. */
  const recipients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const line of basketLines) {
      if (!seen.has(line.customerId)) seen.set(line.customerId, line.customerName);
    }
    return [...seen.entries()].map(([customerId, customerName]) => ({ customerId, customerName }));
  }, [basketLines]);

  const orderOptions: SelectOption[] = useMemo(
    () =>
      readyOrders.map((order) => {
        const customer = customerOf(order);
        const picked = basketLines.filter((line) => line.orderId === order.id).length;
        const flags = [
          picked > 0 ? `${picked} picked` : null,
          openOrderIds.has(order.id) ? "has an open run" : null,
          order.fulfillment_status === "partially_delivered" ? "part-delivered" : null,
        ].filter(Boolean);
        return {
          id: order.id,
          label: order.order_no,
          sublabel: `${customer?.name ?? "Customer"} · ${order.status}${
            flags.length > 0 ? ` · ${flags.join(" · ")}` : ""
          }`,
          keywords: haystack(customer?.name, customer?.phone, order.status),
        };
      }),
    [readyOrders, basketLines, openOrderIds],
  );

  const staffOptions: SelectOption[] = useMemo(
    () => staff.map((s) => ({ id: s.id, label: s.name, sublabel: s.role ?? undefined })),
    [staff],
  );

  const browsingOrder = useMemo(
    () => readyOrders.find((order) => order.id === browsingOrderId) ?? null,
    [readyOrders, browsingOrderId],
  );

  const browsingItems = useMemo(
    () =>
      (browsingOrder?.order_items ?? []).map((item) => ({
        item,
        reason: ineligibleReason(item, openItemIds),
      })),
    [browsingOrder, openItemIds],
  );

  const eligibleIds = useMemo(
    () => browsingItems.filter((row) => row.reason === null).map((row) => row.item.id),
    [browsingItems],
  );

  function toggleItem(itemId: string) {
    if (!browsingOrder) return;
    const item = (browsingOrder.order_items ?? []).find((candidate) => candidate.id === itemId);
    if (!item) return;
    const customer = customerOf(browsingOrder);

    setBasket((prev) => {
      if (prev[itemId]) {
        // Immutable removal — never `delete prev[itemId]`.
        const { [itemId]: _removed, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [itemId]: {
          itemId,
          orderId: browsingOrder.id,
          orderNo: browsingOrder.order_no,
          customerId: customer?.id ?? "",
          customerName: customer?.name ?? "Customer",
          description: item.description ?? "Item",
          qty: item.qty ?? 1,
          unit: item.unit ?? null,
        },
      };
    });
  }

  function removeOrderFromBasket(orderId: string) {
    setBasket((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([, line]) => line.orderId !== orderId),
      ),
    );
  }

  function selectAllEligible() {
    if (!browsingOrder) return;
    const allPicked = eligibleIds.every((id) => basket[id]);
    if (allPicked) {
      setBasket((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([id]) => !eligibleIds.includes(id))),
      );
      return;
    }
    for (const id of eligibleIds) if (!basket[id]) toggleItem(id);
  }

  function draftFor(customerId: string, customerName: string): ConsignmentDraft {
    return drafts[customerId] ?? emptyDraft(customerId, customerName);
  }

  function updateDraft(
    customerId: string,
    customerName: string,
    field: keyof Omit<ConsignmentDraft, "customerId" | "customerName">,
    value: string,
  ) {
    setDrafts((prev) => ({
      ...prev,
      [customerId]: { ...draftFor(customerId, customerName), [field]: value },
    }));
  }

  function resetModal() {
    setShowModal(false);
    setBrowsingOrderId("");
    setBasket({});
    setDrafts({});
    setDriverId("");
    setVehicleNo("");
    setEwayBillNo("");
    setNotes("");
  }

  /* ── Search + filters over the board ──────────────────────────────────────── */

  const searchable = useMemo(
    () =>
      optimisticDeliveries.map((delivery) => {
        const orders = ordersOf(delivery);
        const people = recipientsOf(delivery);
        const driver = driverOf(delivery);
        return {
          row: delivery,
          text: haystack(
            ...orders.map((order) => order.order_no),
            ...people.map((person) => person.name),
            ...people.map((person) => person.phone),
            driver?.name,
            delivery.vehicle_no,
            delivery.eway_bill_no,
            delivery.notes,
            delivery.scheduled_date,
            delivery.status,
          ),
        };
      }),
    [optimisticDeliveries],
  );

  const matchingQuery = useMemo(
    () => searchable.filter((s) => matchesQuery(s.text, query)),
    [searchable, query],
  );

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: matchingQuery.length };
    for (const f of STATUS_FILTERS) {
      if (f.id === "all") continue;
      base[f.id] = matchingQuery.filter((s) => s.row.status === f.id).length;
    }
    return base;
  }, [matchingQuery]);

  const visible = useMemo(
    () =>
      (statusFilter === "all"
        ? matchingQuery
        : matchingQuery.filter((s) => s.row.status === statusFilter)
      ).map((s) => s.row),
    [matchingQuery, statusFilter],
  );

  const isFiltered = query.trim() !== "" || statusFilter !== "all";

  /* ── Submit ───────────────────────────────────────────────────────────────── */

  function handleSchedule() {
    setError(null);
    if (basketLines.length === 0) {
      setError("Tick the items going out on this run — a delivery is a set of items, not a whole order.");
      return;
    }

    startTransition(async () => {
      const lines = basketLines;
      const orderIds = [...new Set(lines.map((line) => line.orderId))];
      const consignments = recipients.map((recipient) =>
        draftFor(recipient.customerId, recipient.customerName),
      );
      const targetDriver = driverId ? staff.find((s) => s.id === driverId) : null;

      addOptimisticDelivery({
        id: `temp-${Date.now()}`,
        status: "scheduled",
        scheduled_date: scheduledDate,
        delivered_at: null,
        vehicle_no: vehicleNo || null,
        eway_bill_no: ewayBillNo || null,
        notes: notes || null,
        salespersons: targetDriver ? { name: targetDriver.name } : null,
        // The optimistic row carries the same derived shape the server will return, so the
        // board renders identically before and after the round-trip — AND so `openItemIds`
        // already knows about these pieces: a second modal opened before the server
        // responds cannot double-book them.
        delivery_consignments: recipients.map((recipient) => ({
          id: `temp-${recipient.customerId}`,
          customer_id: recipient.customerId,
          challan_no: null,
          customers: { id: recipient.customerId, name: recipient.customerName },
        })),
        delivery_items: lines.map((line) => ({
          order_item_id: line.itemId,
          order_id: line.orderId,
          customer_id: line.customerId,
          received: true,
          order_items: {
            id: line.itemId,
            description: line.description,
            qty: line.qty,
            unit: line.unit,
            orders: { id: line.orderId, order_no: line.orderNo },
          },
        })),
      });

      // Snapshot BEFORE clearing. If the write is refused — a double-booked item, an order
      // this user may not touch — the basket is put back exactly as it was: a manager who
      // spent a minute picking twelve pieces across three orders must not have to redo it
      // because one of them was taken.
      const snapshot = { basket, drafts, driverId, vehicleNo, ewayBillNo, notes };
      resetModal();

      const res = await scheduleDeliveryAction({
        scheduledDate,
        itemIds: lines.map((line) => line.itemId),
        driverId: driverId || undefined,
        vehicleNo: vehicleNo || undefined,
        ewayBillNo: ewayBillNo || undefined,
        notes: notes || undefined,
        consignments: consignments.map((draft) => ({
          customerId: draft.customerId,
          deliveryAddress: draft.deliveryAddress || undefined,
          deliveryRent: draft.deliveryRent || undefined,
          dpCode: draft.dpCode || undefined,
        })),
        orderIds,
      });

      if (res.error) {
        setBasket(snapshot.basket);
        setDrafts(snapshot.drafts);
        setDriverId(snapshot.driverId);
        setVehicleNo(snapshot.vehicleNo);
        setEwayBillNo(snapshot.ewayBillNo);
        setNotes(snapshot.notes);
        setError(res.error);
        setShowModal(true);
        return;
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title text-t1 font-bold">Delivery &amp; Installation Dispatch</h2>
          <p className="text-body text-t2 mt-0.5">
            One run can carry finished pieces from several orders — schedule drivers, track
            E-Way bills &amp; view installation proofs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowModal(true)}
            className="text-caption font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-card transition-all flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>Schedule Delivery</span>
          </button>
          <Link
            href="/delivery"
            className="text-caption font-semibold bg-sf2 hover:bg-sf3 text-t1 border border-ln px-3.5 py-2 rounded-card transition-colors"
          >
            Open Driver PWA 📱
          </Link>
        </div>
      </div>

      {/* Search + status filters */}
      <Card className="p-3 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-t3 absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.8} />
          <input
            type="search"
            value={query}
            placeholder="Search order no, customer, mobile, driver, vehicle or E-Way bill…"
            aria-label="Search deliveries"
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-sf2 border border-ln rounded-md text-ui text-t1 placeholder-t3 focus:outline-none focus:border-acc focus:bg-sf transition-all"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                aria-pressed={active}
                className={`shrink-0 px-2.5 py-1.5 rounded-md border text-caption font-semibold transition-colors flex items-center gap-1.5 ${
                  active
                    ? "bg-acc text-white border-acc"
                    : "bg-sf2 border-ln text-t2 hover:border-accL hover:text-t1"
                }`}
              >
                {f.label}
                <span className={`font-mono ${active ? "opacity-75" : "text-t3"}`}>
                  {counts[f.id] ?? 0}
                </span>
              </button>
            );
          })}

          {isFiltered && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
              className="shrink-0 px-2.5 py-1.5 rounded-md border border-ln bg-sf2 text-caption font-semibold text-t3 hover:text-t1 flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
      </Card>

      {/* Deliveries List Card */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-ln flex items-center justify-between">
          <SectionHeader
            label="Scheduled &amp; Delivered Runs"
            total={isFiltered ? `${visible.length} of ${deliveries.length}` : `${deliveries.length} total`}
          />
        </div>

        {visible.length === 0 ? (
          <div className="p-12 text-center text-t3 space-y-2">
            <Truck className="w-10 h-10 text-t3 mx-auto" />
            <p className="font-semibold text-t2">
              {isFiltered ? "No deliveries match this search" : "No deliveries scheduled yet"}
            </p>
            <p className="text-caption text-t3">
              {isFiltered
                ? "Try a different order number, customer, driver or vehicle."
                : "Schedule a run for any finished pieces above — they can come from different orders."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body">
              <thead>
                <tr className="border-b border-ln text-label-sm uppercase text-t3 bg-sf2">
                  <th className="px-4 py-3 font-semibold">Orders &amp; Customers</th>
                  <th className="px-4 py-3 font-semibold">Items on this run</th>
                  <th className="px-4 py-3 font-semibold">Scheduled Date</th>
                  <th className="px-4 py-3 font-semibold">Assigned Driver</th>
                  <th className="px-4 py-3 font-semibold">Vehicle &amp; E-Way Bill</th>
                  <th className="px-4 py-3 font-semibold">Challans</th>
                  <th className="px-4 py-3 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ln2">
                {visible.map((delivery) => {
                  const orders = ordersOf(delivery);
                  const people = recipientsOf(delivery);
                  const driver = driverOf(delivery);
                  const runItems = itemsOf(delivery);
                  const consignments = delivery.delivery_consignments ?? [];
                  const isOptimistic = delivery.id.startsWith("temp-");

                  return (
                    <tr key={delivery.id} className="hover:bg-sf2 transition-colors">
                      <td className="px-4 py-3 space-y-1">
                        {/* EVERY order on the run, not the first: a row naming one order
                            would be indistinguishable from a single-order run and would
                            hide goods the manager is accountable for. */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {orders.length === 0 ? (
                            <span className="text-t3 text-caption">No lines</span>
                          ) : (
                            orders.map((order) => (
                              <Link
                                key={order.id ?? order.order_no}
                                href={`/dashboard/orders/${order.id ?? ""}`}
                                className="font-bold text-acc font-mono text-caption hover:underline"
                              >
                                {order.order_no || "ORD-???"}
                              </Link>
                            ))
                          )}
                        </div>
                        {people.map((person) => (
                          <p key={person.id ?? person.name} className="text-nav font-semibold text-t1">
                            {person.name || "Customer"}
                            {person.phone && (
                              <span className="ml-1.5 font-mono text-caption font-normal text-t3">
                                {person.phone}
                              </span>
                            )}
                          </p>
                        ))}
                        {people.length > 1 && (
                          <Pill tone="warn" dot={false}>
                            {people.length} drops
                          </Pill>
                        )}
                      </td>
                      <td className="px-4 py-3 text-caption text-t2 space-y-0.5">
                        {runItems.length === 0 ? (
                          // A pre-0039 delivery, or one whose backfill has not run. Saying
                          // "whole order" is what it actually meant, rather than "—".
                          <span className="text-t3">Whole order</span>
                        ) : (
                          <>
                            {runItems.slice(0, 3).map((item) => (
                              <div key={item.id} className="truncate max-w-[15rem]">
                                {item.description ?? "Item"}
                                <span className="ml-1 font-mono tabular-nums text-t3">
                                  ×{item.qty ?? 1}
                                </span>
                              </div>
                            ))}
                            {runItems.length > 3 && (
                              <div className="text-t3 font-mono tabular-nums">
                                +{runItems.length - 3} more
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-t1 text-caption">
                        {delivery.scheduled_date}
                      </td>
                      <td className="px-4 py-3 text-caption text-t2 font-medium">
                        {driver?.name || "Unassigned"}
                      </td>
                      <td className="px-4 py-3 font-mono text-caption text-t3 space-y-0.5">
                        {delivery.vehicle_no && (
                          <div className="text-t1 font-semibold">Vehicle: {delivery.vehicle_no}</div>
                        )}
                        {delivery.eway_bill_no && <div>E-Way: {delivery.eway_bill_no}</div>}
                        {!delivery.vehicle_no && !delivery.eway_bill_no && "—"}
                      </td>
                      <td className="px-4 py-3">
                        {/* ONE CHALLAN PER RECIPIENT. An optimistic row has no server ids
                            yet, so its buttons appear once the insert lands. */}
                        {isOptimistic || consignments.length === 0 ? (
                          <span className="text-caption text-t3">—</span>
                        ) : (
                          <div className="flex flex-col items-start gap-1">
                            {consignments.map((consignment) => (
                              <ChallanButton
                                key={consignment.id}
                                consignmentId={consignment.id}
                                orderIds={orders
                                  .map((order) => order.id)
                                  .filter((id): id is string => Boolean(id))}
                                challanNo={consignment.challan_no}
                                recipientName={
                                  consignments.length > 1
                                    ? customerOf(consignment)?.name ?? null
                                    : null
                                }
                              />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Pill
                          tone={
                            delivery.status === "delivered"
                              ? "pos"
                              : delivery.status === "failed"
                                ? "warn"
                                : "neutral"
                          }
                          dot={false}
                        >
                          {delivery.status}
                        </Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Schedule Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-sf border border-ln rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-ln pb-3">
              <h3 className="text-body font-bold text-t1 flex items-center gap-2">
                <Truck className="w-5 h-5 text-emerald-500" />
                <span>Schedule a Delivery Run</span>
              </h3>
              <button onClick={resetModal} className="text-t3 hover:text-t1 text-caption font-bold">✕</button>
            </div>

            {error && (
              <div className="p-3 rounded-card bg-warnS border border-warn text-caption text-warn font-semibold">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">
                  Add items from an order
                </label>
                <SearchableSelect
                  options={orderOptions}
                  value={browsingOrderId}
                  onChange={setBrowsingOrderId}
                  placeholder="-- Choose Ready / Production Order --"
                  searchPlaceholder="Search order no, customer or mobile…"
                  emptyLabel="No ready or in-production orders match"
                />
                <p className="mt-1 text-[11px] text-t3">
                  Pick items, then choose another order to add more to the same run — the
                  basket below is what goes on the lorry.
                </p>
              </div>

              {/* ITEM CHECKLIST. Ineligible lines are shown GREYED WITH A REASON rather
                  than hidden: the manager loading the lorry needs to know why a piece is
                  not going, and a missing row looks like a data bug. */}
              {browsingOrder && (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="text-label-sm uppercase font-semibold text-t3">
                      {browsingOrder.order_no} · items
                    </label>
                    {eligibleIds.length > 0 && (
                      <button
                        type="button"
                        onClick={selectAllEligible}
                        className="text-[11px] font-semibold text-acc hover:underline"
                      >
                        {eligibleIds.every((id) => basket[id])
                          ? "Clear this order"
                          : "Select all deliverable"}
                      </button>
                    )}
                  </div>

                  {browsingItems.length === 0 ? (
                    <p className="rounded-card border border-ln bg-sf2 p-3 text-caption text-t3">
                      This order has no line items.
                    </p>
                  ) : (
                    <div className="max-h-52 divide-y divide-ln2 overflow-y-auto rounded-card border border-ln bg-sf2">
                      {browsingItems.map(({ item, reason }) => (
                        <label
                          key={item.id}
                          className={`flex items-start gap-2.5 p-2.5 ${
                            reason ? "opacity-60" : "cursor-pointer hover:bg-sf"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            disabled={reason !== null}
                            checked={Boolean(basket[item.id])}
                            onChange={() => toggleItem(item.id)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-caption font-semibold text-t1">
                              {item.description ?? "Item"}
                            </span>
                            <span className="block text-[11px] font-mono tabular-nums text-t3">
                              {item.qty ?? 1} {item.unit ?? "nos"}
                              {reason ? ` · ${reason}` : ""}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* THE BASKET — the run itself, grouped by the order each piece came off. */}
              <div>
                <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">
                  On this run *
                </label>
                {basketLines.length === 0 ? (
                  <p className="rounded-card border border-dashed border-ln bg-sf2 p-3 text-caption text-t3">
                    Nothing picked yet. Choose an order above and tick the finished pieces.
                  </p>
                ) : (
                  <div className="divide-y divide-ln2 rounded-card border border-ln bg-sf2">
                    {basketByOrder.map((group) => (
                      <div key={group.orderId} className="p-2.5 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-caption font-semibold text-t1">
                            <span className="font-mono">{group.orderNo}</span>
                            <span className="ml-1.5 font-normal text-t3">{group.customerName}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => removeOrderFromBasket(group.orderId)}
                            aria-label={`Remove all ${group.orderNo} items from this run`}
                            className="text-t3 hover:text-warn"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {group.lines.map((line) => (
                          <div
                            key={line.itemId}
                            className="flex items-center justify-between gap-2 text-[11px] text-t2"
                          >
                            <span className="truncate">{line.description}</span>
                            <span className="flex items-center gap-2">
                              <span className="font-mono tabular-nums text-t3">
                                {line.qty ?? 1} {line.unit ?? "nos"}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setBasket((prev) => {
                                    const { [line.itemId]: _gone, ...rest } = prev;
                                    return rest;
                                  })
                                }
                                aria-label={`Remove ${line.description} from this run`}
                                className="text-t3 hover:text-warn"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* PARTIAL DELIVERY IS LEGITIMATE, not an error — it is the whole point of
                    this feature. Stated plainly so nobody assumes they must wait for the
                    slowest item, or for one order at a time. */}
                {basketLines.length > 0 && (
                  <p className="mt-1 text-[11px] font-semibold text-t2">
                    <span className="font-mono tabular-nums">{basketLines.length}</span> item
                    {basketLines.length === 1 ? "" : "s"} from{" "}
                    <span className="font-mono tabular-nums">{basketByOrder.length}</span> order
                    {basketByOrder.length === 1 ? "" : "s"} ·{" "}
                    <span className="font-mono tabular-nums">{recipients.length}</span> challan
                    {recipients.length === 1 ? "" : "s"}. Each order stays open until the rest
                    of it goes out.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">Delivery Date *</label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full bg-sf2 border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 focus:outline-none focus:border-acc"
                  />
                </div>

                <div>
                  <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">Assign Driver / Staff</label>
                  <SearchableSelect
                    options={staffOptions}
                    value={driverId}
                    onChange={setDriverId}
                    placeholder="-- Select Staff --"
                    searchPlaceholder="Search staff by name or role…"
                    emptyLabel="No staff match"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">Vehicle No (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. GJ-05-XX-1234"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    className="w-full bg-sf2 border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 focus:outline-none focus:border-acc"
                  />
                </div>

                <div>
                  <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">E-Way Bill No (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 121000998877"
                    value={ewayBillNo}
                    onChange={(e) => setEwayBillNo(e.target.value)}
                    className="w-full bg-sf2 border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 focus:outline-none focus:border-acc"
                  />
                </div>
              </div>

              {/* ONE PAPERWORK BLOCK PER RECIPIENT (0040). Their challan carries a ship-to
                  address, a delivery rent and the "D.P" line, and all three are
                  per-recipient — the same lorry may drop one customer at a site and
                  another at a flat. Derived from the basket, so a block cannot exist for a
                  customer with nothing on the run (the DB refuses that too). */}
              {recipients.map((recipient) => {
                const draft = draftFor(recipient.customerId, recipient.customerName);
                return (
                  <div
                    key={recipient.customerId}
                    className="rounded-card border border-ln bg-sf2 p-3 space-y-2"
                  >
                    <p className="text-label-sm uppercase font-semibold text-t3">
                      Challan for {recipient.customerName}
                    </p>
                    <input
                      type="text"
                      placeholder="Delivery address — printed on this customer's challan"
                      value={draft.deliveryAddress}
                      onChange={(e) =>
                        updateDraft(recipient.customerId, recipient.customerName, "deliveryAddress", e.target.value)
                      }
                      className="w-full bg-sf border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 focus:outline-none focus:border-acc"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="number"
                        min={0}
                        inputMode="decimal"
                        placeholder="Delivery rent (optional)"
                        value={draft.deliveryRent}
                        onChange={(e) =>
                          updateDraft(recipient.customerId, recipient.customerName, "deliveryRent", e.target.value)
                        }
                        className="w-full bg-sf border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 font-mono tabular-nums focus:outline-none focus:border-acc"
                      />
                      <input
                        type="text"
                        placeholder="D.P (e.g. ASG)"
                        value={draft.dpCode}
                        onChange={(e) =>
                          updateDraft(recipient.customerId, recipient.customerName, "dpCode", e.target.value)
                        }
                        className="w-full bg-sf border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 focus:outline-none focus:border-acc"
                      />
                    </div>
                  </div>
                );
              })}

              <div>
                <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">Notes / Instructions</label>
                <input
                  type="text"
                  placeholder="e.g. Handle glass tabletops with extra care..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-sf2 border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 focus:outline-none focus:border-acc"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-ln">
              <button
                onClick={resetModal}
                className="text-caption font-semibold text-t3 hover:text-t1 px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={isPending || basketLines.length === 0}
                className="text-caption font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-card shadow-md shadow-emerald-600/20 disabled:opacity-50"
              >
                {isPending ? "Scheduling..." : "Confirm Schedule →"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
