"use client";

import { useMemo, useState, useTransition, useOptimistic } from "react";
import Link from "next/link";
import { Truck, Plus, Search, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
import SearchableSelect, { type SelectOption } from "@/components/ui/SearchableSelect";
import { haystack, matchesQuery } from "@/lib/textFilter";
import { scheduleDeliveryAction } from "./actions";
import type { DeliveryRow, ReadyOrderRow, StaffRow } from "./types";
import { customerOf, driverOf, orderOf } from "./types";

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

    startTransition(async () => {
      const targetOrder = readyOrders.find((o) => o.id === orderId);
      const targetDriver = driverId ? staff.find((s) => s.id === driverId) : null;
      
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
      });
      
      setShowModal(false);
      setOrderId("");
      setDriverId("");
      setVehicleNo("");
      setEwayBillNo("");
      setNotes("");

      const res = await scheduleDeliveryAction(
        orderId,
        scheduledDate,
        driverId || undefined,
        vehicleNo || undefined,
        ewayBillNo || undefined,
        notes || undefined,
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
                  <th className="px-4 py-3 font-semibold">Scheduled Date</th>
                  <th className="px-4 py-3 font-semibold">Assigned Driver</th>
                  <th className="px-4 py-3 font-semibold">Vehicle & E-Way Bill</th>
                  <th className="px-4 py-3 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ln2">
                {visible.map((d) => {
                  const order = orderOf(d);
                  const customer = customerOf(order);
                  const driver = driverOf(d);

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
                  onChange={setOrderId}
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
                disabled={isPending || !orderId}
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
