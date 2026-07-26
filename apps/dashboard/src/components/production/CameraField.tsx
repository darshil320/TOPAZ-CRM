"use client";

/**
 * The camera tile: one tap opens the phone's rear camera, shows a thumbnail when the
 * bytes have landed, and says so in Gujarati first.
 *
 * Shared by the workshop queue's photo_required stages, the destination lead's Receive
 * and the courier's pickup/delivery frames — the three places module 14 demands
 * photographic evidence. Keeping it in one component is why "required" looks identical
 * in all three: a manager who has learned the red asterisk on one screen reads it the
 * same way on the next.
 */

import { Camera, Check, ImagePlus, Loader2 } from "lucide-react";
import type { PhotoSlot } from "./usePhotoCapture";

export default function CameraField({
  slotId,
  entityId,
  label,
  required,
  photo,
  onFile,
  openCamera,
  setInputRef,
}: {
  slotId: string;
  entityId: string;
  /** Bilingual label, e.g. "સ્ટેજ ફોટો / Stage Photo". */
  label: string;
  required: boolean;
  photo: PhotoSlot;
  onFile: (slotId: string, entityId: string, file: File) => void;
  openCamera: (slotId: string) => void;
  setInputRef: (slotId: string) => (el: HTMLInputElement | null) => void;
}) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-300 flex items-center gap-1.5">
          <Camera className="w-4 h-4 text-sky-400" />
          <span>{label}</span>
          {required && <span className="text-red-400 font-bold">*</span>}
        </span>

        <button
          type="button"
          onClick={() => openCamera(slotId)}
          disabled={photo.uploading}
          className="text-xs font-semibold text-sky-400 hover:text-sky-300 bg-sky-500/10 border border-sky-500/30 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
        >
          <ImagePlus className="w-3.5 h-3.5" />
          <span>{photo.previewUrl ? "ફરી / Retake" : "ફોટો પાડો / Take photo"}</span>
        </button>
        <input
          ref={setInputRef(slotId)}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(slotId, entityId, file);
            // Reset the input so retaking the SAME file fires onChange again.
            e.target.value = "";
          }}
        />
      </div>

      {photo.uploading && (
        <div className="flex items-center gap-2 text-xs text-sky-400 py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>અપલોડ થાય છે… / Uploading…</span>
        </div>
      )}

      {photo.error && <p className="text-xs font-semibold text-red-400">{photo.error}</p>}

      {photo.previewUrl && !photo.uploading && (
        <div className="flex items-center gap-3 pt-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: preview,
              never a remote asset; next/image cannot optimise an object URL. */}
          <img
            src={photo.previewUrl}
            alt="Handover photo preview"
            className="w-16 h-16 object-cover rounded-lg border border-slate-700 shadow-md"
          />
          <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
            <Check className="w-4 h-4" />
            <span>ફોટો સેવ થયો / Photo saved</span>
          </div>
        </div>
      )}
    </div>
  );
}
