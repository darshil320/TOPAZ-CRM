"use client";

import { useMemo, useState, useTransition, useOptimistic } from "react";
import Link from "next/link";
import { Truck, Plus, Search, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
import SearchableSelect, { type SelectOption } from "@/components/ui/SearchableSelect";
import { haystack, matchesQuery } from "@/lib/textFilter";
import ChallanButton from "./ChallanButton";
import { scheduleDeliveryAction } from "./actions";
import type { DeliveryRow, ReadyOrderRow, StaffRow } from "./types";
import { customerOf, driverOf, ineligibleReason, itemsOf, orderOf } from "./types";

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "scheduled", label: "Scheduled" },
  { id: "in_transit", label: "In transit" },
  { id: "delivered", label: "Delivered" },
  { id: "failed", label: "Failed" },
] as const;

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
  const [orderId, setOrderId] = useState("");
  /** Which of the order's lines travel on this run (0039). Empty = nothing scheduled. */
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [driverId, setDriverId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [vehicleNo, setVehicleNo] = useState("");
  const [ewayBillNo, setEwayBillNo] = useState("");
  const [notes, setNotes] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  // Two more lines on the client's challan (0037). Blank is a legitimate saved state —
  // their pad leaves both to be written in by hand.
  const [deliveryRent, setDeliveryRent] = useState("");
  const [dpCode, setDpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [optimisticDeliveries, addOptimisticDelivery] = useOptimistic(
    deliveries,
    (state, newRow: DeliveryRow) => [newRow, ...state]
  );

  /** Orders that already have a run on the board — flagged, not hidden: a
   * re-delivery after a failed attempt is legitimate, scheduling one twice by
   * accident is not. */
  const scheduledOrderIds = useMemo(
    () => new Set(optimisticDeliveries.filter((d) => d.status !== "failed").map((d) => d.order_id)),
    [optimisticDeliveries],
  );

  const orderOptions: SelectOption[] = useMemo(
    () =>
      readyOrders.map((o) => {
        const customer = customerOf(o);
        const already = scheduledOrderIds.has(o.id);
        return {
          id: o.id,
          label: o.order_no,
          sublabel: `${customer?.name ?? "Customer"} · ${o.status}${already ? " · already scheduled" : ""}`,
          keywords: haystack(customer?.name, customer?.phone, o.status),
        };
      }),
    [readyOrders, scheduledOrderIds],
  );

  const staffOptions: SelectOption[] = useMemo(
    () => staff.map((s) => ({ id: s.id, label: s.name, sublabel: s.role ?? undefined })),
    [staff],
  );

  /* ── The item picker (0039) ───────────────────────────────────────────────── */

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

  const selectedOrder = useMemo(
    () => readyOrders.find((o) => o.id === orderId) ?? null,
    [readyOrders, orderId],
  );

  const orderItems = useMemo(
    () =>
      (selectedOrder?.order_items ?? []).map((item) => ({
        item,
        reason: ineligibleReason(item, openItemIds),
      })),
    [selectedOrder, openItemIds],
  );

  const eligibleIds = useMemo(
    () => orderItems.filter((r) => r.reason === null).map((r) => r.item.id),
    [orderItems],
  );

  function toggleItem(id: string) {
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  /** Picking a different order invalidates the selection entirely. */
  function chooseOrder(id: string) {
    setOrderId(id);
    setSelectedItemIds([]);
  }

  const searchable = useMemo(
    () =>
      optimisticDeliveries.map((d) => {
        const order = orderOf(d);
        const customer = customerOf(order);
        const driver = driverOf(d);
        return {
          row: d,
          text: haystack(
            order?.order_no,
            customer?.name,
            customer?.phone,
            driver?.name,
            d.vehicle_no,
            d.eway_bill_no,
            d.notes,
            d.scheduled_date,
            d.status,
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

  function handleSchedule() {
    setError(null);
    if (!orderId) {
      setError("Please select an order");
      return;
    }
    if (selectedItemIds.length === 0) {
      setError("Tick the items going out on this run — a delivery is a set of items, not a whole order.");
      return;
    }

    startTransition(async () => {
      const targetOrder = readyOrders.find((o) => o.id === orderId);
      const targetDriver = driverId ? staff.find((s) => s.id === driverId) : null;
      const itemIds = selectedItemIds;
      const address = deliveryAddress;
      const rent = deliveryRent;
      const dp = dpCode;

      addOptimisticDelivery({
        id: `temp-${Date.now()}`,
        order_id: orderId,
        status: "scheduled",
        scheduled_date: scheduledDate,
        delivered_at: null,
        vehicle_no: vehicleNo || null,
        eway_bill_no: ewayBillNo || null,
        notes: notes || null,
        orders: targetOrder as any,
        salespersons: targetDriver as any,
        // Optimistically shown on the board row AND fed back into `openItemIds`, so a
        // second modal opened before the server responds cannot double-book the same item.
        delivery_items: itemIds.map((id) => ({
          order_item_id: id,
          order_items: (targetOrder?.order_items ?? []).find((i) => i.id === id) ?? null,
        })),
      });

      setShowModal(false);
      setOrderId("");
      setSelectedItemIds([]);
      setDriverId("");
      setVehicleNo("");
      setEwayBillNo("");
      setNotes("");
      setDeliveryAddress("");
      setDeliveryRent("");
      setDpCode("");

      const res = await scheduleDeliveryAction(
        orderId,
        scheduledDate,
        itemIds,
        driverId || undefined,
        vehicleNo || undefined,
        ewayBillNo || undefined,
        notes || undefined,
        address || undefined,
        rent || undefined,
        dp || undefined,
      );

      if (res.error) {
        setError(res.error);
        return;
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title text-t1 font-bold">Delivery & Installation Dispatch</h2>
          <p className="text-body text-t2 mt-0.5">
            Schedule deliveries, assign drivers, track E-Way bills & view installation proofs
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
            label="Scheduled & Delivered Orders"
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
                : "Schedule a delivery for completed production orders above."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body">
              <thead>
                <tr className="border-b border-ln text-label-sm uppercase text-t3 bg-sf2">
                  <th className="px-4 py-3 font-semibold">Order & Customer</th>
                  <th className="px-4 py-3 font-semibold">Items on this run</th>
                  <th className="px-4 py-3 font-semibold">Scheduled Date</th>
                  <th className="px-4 py-3 font-semibold">Assigned Driver</th>
                  <th className="px-4 py-3 font-semibold">Vehicle & E-Way Bill</th>
                  <th className="px-4 py-3 font-semibold">Challan</th>
                  <th className="px-4 py-3 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ln2">
                {visible.map((d) => {
                  const order = orderOf(d);
                  const customer = customerOf(order);
                  const driver = driverOf(d);
                  const runItems = itemsOf(d);

                  return (
                    <tr key={d.id} className="hover:bg-sf2 transition-colors">
                      <td className="px-4 py-3 space-y-1">
                        <div className="flex items-center gap-2">
                          <Link href={`/dashboard/orders/${d.order_id}`} className="font-bold text-acc font-mono hover:underline">
                            {order?.order_no || "ORD-???"}
                          </Link>
                          <Pill tone={order?.status === "ready" ? "pos" : "neutral"} dot={false}>
                            {order?.status}
                          </Pill>
                        </div>
                        <p className="text-nav font-semibold text-t1">{customer?.name || "Customer"}</p>
                        {customer?.phone && (
                          <p className="text-caption font-mono text-t3">{customer.phone}</p>
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
                        {d.scheduled_date}
                      </td>
                      <td className="px-4 py-3 text-caption text-t2 font-medium">
                        {driver?.name || "Unassigned"}
                      </td>
                      <td className="px-4 py-3 font-mono text-caption text-t3 space-y-0.5">
                        {d.vehicle_no && <div className="text-t1 font-semibold">Vehicle: {d.vehicle_no}</div>}
                        {d.eway_bill_no && <div>E-Way: {d.eway_bill_no}</div>}
                        {!d.vehicle_no && !d.eway_bill_no && "—"}
                      </td>
                      <td className="px-4 py-3">
                        {/* An optimistic row has no server id yet, so its challan cannot
                            be rendered — the button appears once the insert lands. */}
                        {d.id.startsWith("temp-") ? (
                          <span className="text-caption text-t3">—</span>
                        ) : (
                          <ChallanButton
                            deliveryId={d.id}
                            orderId={d.order_id}
                            challanNo={d.challan_no}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Pill tone={d.status === "delivered" ? "pos" : d.status === "failed" ? "warn" : "neutral"} dot={false}>
                          {d.status}
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
          <div className="bg-sf border border-ln rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-ln pb-3">
              <h3 className="text-body font-bold text-t1 flex items-center gap-2">
                <Truck className="w-5 h-5 text-emerald-500" />
                <span>Schedule New Delivery</span>
              </h3>
              <button onClick={() => setShowModal(false)} className="text-t3 hover:text-t1 text-caption font-bold">✕</button>
            </div>

            {error && (
              <div className="p-3 rounded-card bg-warnS border border-warn text-caption text-warn font-semibold">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">Select Order *</label>
                <SearchableSelect
                  options={orderOptions}
                  value={orderId}
                  onChange={chooseOrder}
                  placeholder="-- Choose Ready / Production Order --"
                  searchPlaceholder="Search order no, customer or mobile…"
                  emptyLabel="No ready or in-production orders match"
                />
                {orderId && scheduledOrderIds.has(orderId) && (
                  <p className="mt-1 text-[11px] font-semibold text-warn">
                    This order already has a delivery on the board — schedule again only if the first attempt failed.
                  </p>
                )}
              </div>

              {/* ITEM CHECKLIST (0039). Ineligible lines are shown GREYED WITH A REASON
                  rather than hidden: the manager loading the lorry needs to know why a
                  piece is not going, and a missing row looks like a data bug. */}
              {orderId && (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="text-label-sm uppercase font-semibold text-t3">
                      Items on this run *
                    </label>
                    {eligibleIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedItemIds(
                            selectedItemIds.length === eligibleIds.length ? [] : eligibleIds,
                          )
                        }
                        className="text-[11px] font-semibold text-acc hover:underline"
                      >
                        {selectedItemIds.length === eligibleIds.length
                          ? "Clear all"
                          : "Select all deliverable"}
                      </button>
                    )}
                  </div>

                  {orderItems.length === 0 ? (
                    <p className="rounded-card border border-ln bg-sf2 p-3 text-caption text-t3">
                      This order has no line items.
                    </p>
                  ) : (
                    <div className="max-h-56 divide-y divide-ln2 overflow-y-auto rounded-card border border-ln bg-sf2">
                      {orderItems.map(({ item, reason }) => (
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
                            checked={selectedItemIds.includes(item.id)}
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

                  {/* PARTIAL DELIVERY IS LEGITIMATE, not an error — it is the whole point
                      of this feature. Stated plainly so nobody assumes they must wait for
                      the slowest item. */}
                  {selectedItemIds.length > 0 && selectedItemIds.length < orderItems.length && (
                    <p className="mt-1 text-[11px] font-semibold text-t2">
                      <span className="font-mono tabular-nums">
                        {selectedItemIds.length} of {orderItems.length}
                      </span>{" "}
                      items · partial delivery. The order stays{" "}
                      <span className="font-mono">ready</span> until the rest go out.
                    </p>
                  )}
                </div>
              )}

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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">
                    Delivery Rent (Optional)
                  </label>
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    placeholder="Transport charge for this run"
                    value={deliveryRent}
                    onChange={(e) => setDeliveryRent(e.target.value)}
                    className="w-full bg-sf2 border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 font-mono tabular-nums focus:outline-none focus:border-acc"
                  />
                </div>
                <div>
                  <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">
                    D.P (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ASG"
                    value={dpCode}
                    onChange={(e) => setDpCode(e.target.value)}
                    className="w-full bg-sf2 border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 focus:outline-none focus:border-acc"
                  />
                </div>
              </div>

              <div>
                <label className="text-label-sm uppercase font-semibold text-t3 block mb-1">
                  Delivery Address
                </label>
                <input
                  type="text"
                  placeholder="Where the goods are going — printed on the challan"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  className="w-full bg-sf2 border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 focus:outline-none focus:border-acc"
                />
              </div>

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
                onClick={() => setShowModal(false)}
                className="text-caption font-semibold text-t3 hover:text-t1 px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={isPending || !orderId || selectedItemIds.length === 0}
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
