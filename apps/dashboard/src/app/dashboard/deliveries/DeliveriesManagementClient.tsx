"use client";

import { useState, useTransition } from "react";
import { Truck, Plus, Calendar, CheckCircle2, Clock, Phone, MapPin, Share2, FileText } from "lucide-react";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
import Link from "next/link";
import { scheduleDeliveryAction } from "./actions";

export default function DeliveriesManagementClient({
  deliveries,
  readyOrders,
  staff,
}: {
  deliveries: any[];
  readyOrders: any[];
  staff: any[];
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

  function handleSchedule() {
    setError(null);
    if (!orderId) {
      setError("Please select an order");
      return;
    }

    startTransition(async () => {
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

      setShowModal(false);
      setOrderId("");
      setVehicleNo("");
      setEwayBillNo("");
      setNotes("");
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

      {/* Deliveries List Card */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-ln flex items-center justify-between">
          <SectionHeader label="Scheduled & Delivered Orders" total={`${deliveries.length} total`} />
        </div>

        {deliveries.length === 0 ? (
          <div className="p-12 text-center text-t3 space-y-2">
            <Truck className="w-10 h-10 text-t3 mx-auto" />
            <p className="font-semibold text-t2">No deliveries scheduled yet</p>
            <p className="text-caption text-t3">Schedule a delivery for completed production orders above.</p>
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
                {deliveries.map((d) => {
                  const orderObj = Array.isArray(d.orders) ? d.orders[0] : d.orders;
                  const custObj = orderObj?.customers ? (Array.isArray(orderObj.customers) ? orderObj.customers[0] : orderObj.customers) : null;
                  const driverObj = Array.isArray(d.salespersons) ? d.salespersons[0] : d.salespersons;

                  return (
                    <tr key={d.id} className="hover:bg-sf2 transition-colors">
                      <td className="px-4 py-3 space-y-1">
                        <div className="flex items-center gap-2">
                          <Link href={`/dashboard/orders/${d.order_id}`} className="font-bold text-acc font-mono hover:underline">
                            {orderObj?.order_no || "ORD-???"}
                          </Link>
                          <Pill tone={orderObj?.status === "ready" ? "pos" : "neutral"} dot={false}>
                            {orderObj?.status}
                          </Pill>
                        </div>
                        <p className="text-nav font-semibold text-t1">{custObj?.name || "Customer"}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-t1 text-caption">
                        {d.scheduled_date}
                      </td>
                      <td className="px-4 py-3 text-caption text-t2 font-medium">
                        {driverObj?.name || "Unassigned"}
                      </td>
                      <td className="px-4 py-3 font-mono text-caption text-t3 space-y-0.5">
                        {d.vehicle_no && <div className="text-t1 font-semibold">Vehicle: {d.vehicle_no}</div>}
                        {d.eway_bill_no && <div>E-Way: {d.eway_bill_no}</div>}
                        {!d.vehicle_no && !d.eway_bill_no && "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Pill tone={d.status === "delivered" ? "pos" : "warn"} dot={false}>
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
                <select
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  className="w-full bg-sf2 border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 focus:outline-none focus:border-acc"
                >
                  <option value="">-- Choose Ready / Production Order --</option>
                  {readyOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_no} — {o.customers?.name || "Customer"} ({o.status})
                    </option>
                  ))}
                </select>
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
                  <select
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    className="w-full bg-sf2 border border-ln rounded-card p-2.5 text-caption font-semibold text-t1 focus:outline-none focus:border-acc"
                  >
                    <option value="">-- Select Staff --</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                    ))}
                  </select>
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
