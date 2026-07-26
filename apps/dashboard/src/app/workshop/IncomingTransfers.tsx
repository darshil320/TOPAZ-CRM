"use client";

/**
 * "Incoming" — consignments on their way to a workshop this person staffs.
 *
 * Sits ABOVE the queue on purpose: a tempo waiting outside is more urgent than the
 * work already on the floor, and it is the only thing on this screen that another
 * workshop is blocked on.
 *
 * RECEIVE IS LEAD-ONLY AND PHOTO-REQUIRED (module 14 D4/D10, both enforced by the API
 * — this component only hides the button). It is the call that actually moves custody:
 * the destination leg goes active, the item's workshop flips, and the transit lock
 * clears so stages can be ticked again.
 */

import { useState, useTransition } from "react";
import { ArrowRight, Clock, PackageCheck, Phone, Truck } from "lucide-react";
import CameraField from "@/components/production/CameraField";
import { usePhotoCapture } from "@/components/production/usePhotoCapture";
import { TRANSFER_STATUS_LABEL, describeDue } from "@/lib/production/format";
import type { TransferSummary } from "@/lib/production/types";
import { receiveTransferAction } from "./actions";

export default function IncomingTransfers({
  transfers,
  canReceive,
}: {
  transfers: TransferSummary[];
  canReceive: boolean;
}) {
  const [rows, setRows] = useState<TransferSummary[]>(transfers);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const photos = usePhotoCapture({ entityType: "workshop_transfer", kind: "transit" });

  if (rows.length === 0) return null;

  function handleReceive(transfer: TransferSummary) {
    setError(null);
    const photo = photos.slot(transfer.id);
    if (!photo.mediaId) {
      setError("📷 सामान की फ़ोटो लें / Take a photo of the goods as they arrived");
      return;
    }
    startTransition(async () => {
      const res = await receiveTransferAction(transfer.id, photo.mediaId!);
      if (res.error) {
        setError(res.error);
        return;
      }
      photos.clear(transfer.id);
      setRows((prev) => prev.filter((t) => t.id !== transfer.id));
      setOpen(null);
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Truck className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-extrabold text-white">
          आ रहा है / Incoming
          <span className="ml-2 text-xs font-mono font-bold text-sky-300 bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded">
            {rows.length}
          </span>
        </h3>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-semibold text-red-400">
          {error}
        </div>
      )}

      {rows.map((transfer) => {
        const due = describeDue(transfer.due_at);
        const photo = photos.slot(transfer.id);
        const expanded = open === transfer.id;
        // `delivered` means the driver says the goods are here. `in_transit` still
        // allows Receive: the courier's phone dies often enough that "the tempo is at
        // the gate, he never tapped Delivered" must not strand the goods (the API
        // permits both predecessors for exactly this reason).
        const arrived = transfer.status === "delivered" || transfer.status === "in_transit";

        return (
          <div
            key={transfer.id}
            className="rounded-2xl border border-sky-500/30 bg-sky-950/20 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono font-bold text-sky-300 bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded">
                    {transfer.transfer_no}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-300">
                    {TRANSFER_STATUS_LABEL[transfer.status] ?? transfer.status}
                  </span>
                </div>
                <p className="text-sm font-bold text-white flex items-center gap-1.5 flex-wrap">
                  <span>{transfer.from_workshop_name}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
                  <span>{transfer.to_workshop_name}</span>
                </p>
                <p className="text-xs text-slate-400 font-mono">
                  {transfer.item_count ?? transfer.items?.length ?? 0} आइटम / item(s)
                  {transfer.vehicle_no && ` · ${transfer.vehicle_no}`}
                  {transfer.courier_name && ` · ${transfer.courier_name}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`text-[11px] font-mono font-semibold block ${
                    due.overdue ? "text-red-300" : "text-slate-400"
                  }`}
                >
                  <Clock className="w-3 h-3 inline mr-1" />
                  {due.label}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">{due.relative}</span>
              </div>
            </div>

            {transfer.from_workshop_phone && (
              <a
                href={`tel:${transfer.from_workshop_phone}`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/70 border border-slate-700 px-2.5 py-1 rounded-lg"
              >
                <Phone className="w-3.5 h-3.5" />
                {transfer.from_workshop_phone}
              </a>
            )}

            {canReceive ? (
              expanded ? (
                <div className="space-y-3">
                  <CameraField
                    slotId={transfer.id}
                    entityId={transfer.id}
                    label="सामान मिलने की फ़ोटो / Photo on arrival"
                    required
                    photo={photo}
                    onFile={photos.upload}
                    openCamera={photos.openCamera}
                    setInputRef={photos.setInputRef}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleReceive(transfer)}
                      disabled={isPending || photo.uploading || !photo.mediaId}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 py-3 px-4 rounded-xl font-bold text-sm transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <PackageCheck className="w-4 h-4" />
                      <span>✓ स्वीकार करें / Confirm receipt</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(null)}
                      className="py-3 px-3.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white border border-slate-700"
                    >
                      रद्द / Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(transfer.id)}
                  disabled={!arrived}
                  className="w-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 py-2.5 px-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <PackageCheck className="w-4 h-4" />
                  <span>
                    {arrived
                      ? "सामान आ गया — स्वीकार करें / Goods arrived — receive"
                      : "अभी रास्ते में नहीं निकला / Not dispatched yet"}
                  </span>
                </button>
              )
            ) : (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                सामान स्वीकार करने का काम मुख्य मैनेजर का है।{" "}
                <span className="text-slate-500">
                  Only the workshop lead can accept custody of an incoming consignment.
                </span>
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
