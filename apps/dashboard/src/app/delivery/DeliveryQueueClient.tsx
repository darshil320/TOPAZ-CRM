"use client";

import { useState, useTransition, useRef } from "react";
import { Truck, CheckCircle2, Camera, Phone, MapPin, ImagePlus, Loader2, Check, FileText } from "lucide-react";
import { completeDeliveryAction } from "./actions";
import { signUpload, completeUpload, type MediaMime } from "@/lib/media/actions";
import type { DeliveryQueueItem } from "./page";

const PASSTHROUGH_MIME: Record<string, MediaMime> = {
  "image/png": "image/png",
  "image/webp": "image/webp",
};

interface PhotoState {
  mediaId: string | null;
  previewUrl: string | null;
  uploading: boolean;
  error: string | null;
}

export default function DeliveryQueueClient({
  initialDeliveries,
}: {
  initialDeliveries: DeliveryQueueItem[];
}) {
  const [deliveries, setDeliveries] = useState<DeliveryQueueItem[]>(initialDeliveries);
  const [isPending, startTransition] = useTransition();
  const [photos, setPhotos] = useState<Record<string, PhotoState>>({});
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handleFileSelected(deliveryId: string, file: File) {
    setError(null);
    setPhotos((prev) => ({
      ...prev,
      [deliveryId]: { mediaId: null, previewUrl: URL.createObjectURL(file), uploading: true, error: null },
    }));

    try {
      const mime = (PASSTHROUGH_MIME[file.type] || "image/jpeg") as MediaMime;
      const signRes = await signUpload({
        entityType: "delivery",
        entityId: deliveryId,
        kind: "delivery",
        mime,
      });

      if (signRes.error || !signRes.data?.upload_url || !signRes.data?.media_id) {
        throw new Error(signRes.error || "Failed to initiate upload");
      }

      const mediaId = signRes.data.media_id;
      const uploadUrl = signRes.data.upload_url;

      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });

      if (!uploadResp.ok) {
        throw new Error(`Upload failed (${uploadResp.status})`);
      }

      const compRes = await completeUpload(mediaId, file.size);
      if (compRes.error) {
        throw new Error(compRes.error);
      }

      setPhotos((prev) => ({
        ...prev,
        [deliveryId]: { mediaId, previewUrl: prev[deliveryId]?.previewUrl || null, uploading: false, error: null },
      }));
    } catch (err) {
      setPhotos((prev) => ({
        ...prev,
        [deliveryId]: { mediaId: null, previewUrl: null, uploading: false, error: err instanceof Error ? err.message : "Upload failed" },
      }));
    }
  }

  function handleComplete(delivery: DeliveryQueueItem) {
    setError(null);
    const photo = photos[delivery.id];
    const notes = notesMap[delivery.id];

    if (!photo?.mediaId) {
      setError("📷 इंस्टॉलेशन प्रूफ फोटो जरूरी है / Proof of installation photo required");
      return;
    }

    startTransition(async () => {
      const res = await completeDeliveryAction(delivery.id, notes, photo.mediaId || undefined);
      if (res.error) {
        setError(res.error);
        return;
      }

      setDeliveries((prev) => prev.filter((d) => d.id !== delivery.id));
    });
  }

  if (deliveries.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
        <h3 className="text-base font-bold text-white">कोई डिलीवरी बाकी नहीं / No Pending Deliveries!</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">
          All scheduled deliveries have been completed with installation proof.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs font-semibold text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {deliveries.map((delivery) => {
        const photo = photos[delivery.id];
        const formattedPhone = (delivery.customer_phone || "").replace(/\D/g, "");

        return (
          <div
            key={delivery.id}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5 space-y-4 shadow-xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 px-2 py-0.5 rounded">
                    {delivery.order_no}
                  </span>
                  <span className="text-xs font-semibold text-slate-300">
                    Scheduled: {delivery.scheduled_date}
                  </span>
                </div>
                <h3 className="text-base font-extrabold text-white">{delivery.customer_name}</h3>
                <p className="text-xs text-slate-400 font-mono">{delivery.items_summary}</p>
              </div>

              {formattedPhone && (
                <a
                  href={`tel:+${formattedPhone}`}
                  className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center gap-1.5 text-xs font-bold shrink-0"
                >
                  <Phone className="w-4 h-4" /> Call
                </a>
              )}
            </div>

            {/* Vehicle & E-Way Bill info if present */}
            {(delivery.vehicle_no || delivery.eway_bill_no) && (
              <div className="flex flex-wrap gap-3 text-xs font-mono bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-slate-400">
                {delivery.vehicle_no && (
                  <span>Vehicle: <strong className="text-slate-200">{delivery.vehicle_no}</strong></span>
                )}
                {delivery.eway_bill_no && (
                  <span>E-Way Bill: <strong className="text-slate-200">{delivery.eway_bill_no}</strong></span>
                )}
              </div>
            )}

            {/* Installation Proof Photo Field */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-emerald-400" />
                  <span>इंस्टॉलेशन प्रूफ फोटो / Installation Proof Photo</span>
                  <span className="text-red-400 font-bold">*</span>
                </span>

                <button
                  type="button"
                  onClick={() => fileInputRefs.current[delivery.id]?.click()}
                  disabled={photo?.uploading}
                  className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>{photo?.previewUrl ? "Change Photo" : "Take / Pick Photo"}</span>
                </button>
                <input
                  ref={(el) => { fileInputRefs.current[delivery.id] = el; }}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelected(delivery.id, f);
                  }}
                />
              </div>

              {photo?.uploading && (
                <div className="flex items-center gap-2 text-xs text-emerald-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Compressing & uploading proof photo...</span>
                </div>
              )}

              {photo?.error && (
                <p className="text-xs font-semibold text-red-400">{photo.error}</p>
              )}

              {photo?.previewUrl && !photo.uploading && (
                <div className="flex items-center gap-3 pt-1">
                  <img
                    src={photo.previewUrl}
                    alt="Installation proof preview"
                    className="w-16 h-16 object-cover rounded-lg border border-slate-700 shadow-md"
                  />
                  <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                    <Check className="w-4 h-4" />
                    <span>Proof photo uploaded</span>
                  </div>
                </div>
              )}
            </div>

            {/* Delivery Notes */}
            <input
              type="text"
              placeholder="Delivery notes (e.g. Received by Mr. Sanjay at site...)"
              value={notesMap[delivery.id] || ""}
              onChange={(e) => setNotesMap({ ...notesMap, [delivery.id]: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />

            {/* Action Button */}
            <button
              type="button"
              onClick={() => handleComplete(delivery)}
              disabled={isPending || photo?.uploading || !photo?.mediaId}
              className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 py-3 px-4 rounded-xl font-bold text-sm transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <span>डिलीवरी पूरी हो रही है… / Processing…</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>✓ डिलीवरी और इंस्टॉलेशन पूर्ण / Mark Delivered & Installed</span>
                </>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
