"use client";

import { useState, useTransition, useRef } from "react";
import { CheckCircle2, AlertOctagon, Camera, ArrowRight, ShieldAlert, Sparkles, ImagePlus, Loader2, Check } from "lucide-react";
import { advanceStageAction, toggleBlockAction } from "./actions";
import { signUpload, completeUpload, type MediaMime } from "@/lib/media/actions";
import type { WorkshopQueueItem, StageDef } from "./page";

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

export default function WorkshopQueueClient({
  initialItems,
  stages,
}: {
  initialItems: WorkshopQueueItem[];
  stages: StageDef[];
}) {
  const [items, setItems] = useState<WorkshopQueueItem[]>(initialItems);
  const [isPending, startTransition] = useTransition();
  const [photos, setPhotos] = useState<Record<string, PhotoState>>({});
  const [blockNote, setBlockNote] = useState("");
  const [showBlockModal, setShowBlockModal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const stageMap = new Map(stages.map((s) => [s.code, s]));
  const firstStageCode = stages[0]?.code ?? "design_approved";

  async function handleFileSelected(itemId: string, file: File) {
    setError(null);
    setPhotos((prev) => ({
      ...prev,
      [itemId]: { mediaId: null, previewUrl: URL.createObjectURL(file), uploading: true, error: null },
    }));

    try {
      const mime = (PASSTHROUGH_MIME[file.type] || "image/jpeg") as MediaMime;
      const signRes = await signUpload({
        entityType: "order_item",
        entityId: itemId,
        kind: "production",
        mime,
      });

      if (signRes.error || !signRes.data?.upload_url || !signRes.data?.media_id) {
        throw new Error(signRes.error || "Failed to initiate upload");
      }

      const mediaId = signRes.data.media_id;
      const uploadUrl = signRes.data.upload_url;

      // PUT file directly to signed storage URL
      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });

      if (!uploadResp.ok) {
        throw new Error(`Upload failed (${uploadResp.status})`);
      }

      // Complete upload
      const compRes = await completeUpload(mediaId, file.size);
      if (compRes.error) {
        throw new Error(compRes.error);
      }

      setPhotos((prev) => ({
        ...prev,
        [itemId]: { mediaId, previewUrl: prev[itemId]?.previewUrl || null, uploading: false, error: null },
      }));
    } catch (err) {
      setPhotos((prev) => ({
        ...prev,
        [itemId]: { mediaId: null, previewUrl: null, uploading: false, error: err instanceof Error ? err.message : "Photo upload failed" },
      }));
    }
  }

  function handleAdvance(item: WorkshopQueueItem) {
    setError(null);
    const currentCode = item.current_stage || firstStageCode;
    const currentDef = stageMap.get(currentCode);
    const isPhotoReq = currentDef?.photo_required ?? false;
    const photo = photos[item.id];

    if (isPhotoReq && !photo?.mediaId) {
      setError(`📷 ${currentDef?.label_gu || currentDef?.label_en || "Current"} સ્ટેજ માટે ફોટો પાડવો ફરજિયાત છે / Photo required for this stage`);
      return;
    }

    startTransition(async () => {
      const res = await advanceStageAction(item.id, undefined, photo?.mediaId || undefined);
      if (res.error) {
        setError(res.error);
        return;
      }
      // Clear photo state for this item
      setPhotos((prev) => {
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      });

      if (res.done) {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      } else if (res.nextStage) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, current_stage: res.nextStage || i.current_stage } : i,
          ),
        );
      }
    });
  }

  function handleToggleBlock(itemId: string, currentBlocked: boolean) {
    if (!currentBlocked) {
      setShowBlockModal(itemId);
      setBlockNote("");
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await toggleBlockAction(itemId, false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, blocked: false, blocked_at: null } : i)),
      );
    });
  }

  function submitBlock(itemId: string) {
    if (!blockNote.trim()) {
      setError("Please type a reason for blocking this item");
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await toggleBlockAction(itemId, true, blockNote);
      if (res.error) {
        setError(res.error);
        return;
      }
      setShowBlockModal(null);
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, blocked: true, blocked_at: new Date().toISOString() } : i,
        ),
      );
    });
  }

  if (items.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
        <h3 className="text-base font-bold text-white">કોઈ કામ બાકી નથી / All Caught Up!</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">
          There are no items waiting for production in your assigned workshop queue.
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

      {items.map((item) => {
        const currentCode = item.current_stage || firstStageCode;
        const currentDef = stageMap.get(currentCode);
        const currentIndex = stages.findIndex((s) => s.code === currentCode);
        const stageNum = currentIndex >= 0 ? currentIndex + 1 : 1;
        const isPhotoReq = currentDef?.photo_required ?? false;
        const photo = photos[item.id];

        return (
          <div
            key={item.id}
            className={`rounded-2xl border p-4 sm:p-5 transition-all space-y-4 ${
              item.blocked
                ? "bg-red-950/20 border-red-500/40"
                : "bg-slate-900 border-slate-800 hover:border-slate-700 shadow-xl"
            }`}
          >
            {/* Header & Item Info */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 rounded">
                    {item.order_no}
                  </span>
                  <span className="text-xs font-semibold text-slate-300">
                    {item.customer_name}
                  </span>
                  {item.blocked && (
                    <span className="text-[11px] font-bold text-red-400 bg-red-500/20 border border-red-500/30 px-2 py-0.5 rounded flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" /> અવરોધિત / BLOCKED
                    </span>
                  )}
                </div>
                <h3 className="text-base font-extrabold text-white">{item.description}</h3>
                <p className="text-xs text-slate-400 font-mono">
                  {item.qty} {item.unit || "nos"}
                  {item.dimensions && ` · ${item.dimensions}`}
                  {item.material && ` · ${item.material}`}
                </p>
              </div>

              <div className="text-right shrink-0">
                <span className="text-[10px] font-mono font-semibold text-slate-400 block uppercase">
                  {item.workshop_name}
                </span>
                <span className="text-[11px] font-bold text-amber-400">
                  {stageNum} / {stages.length} Stages
                </span>
              </div>
            </div>

            {/* Stage Progress Bar */}
            <div className="space-y-1.5">
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden flex">
                <div
                  className={`h-full transition-all duration-500 ${
                    item.blocked ? "bg-red-500" : "bg-gradient-to-r from-amber-500 to-amber-400"
                  }`}
                  style={{ width: `${(stageNum / stages.length) * 100}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {currentDef?.label_gu ? `${currentDef.label_gu} / ` : ""}
                    {currentDef?.label_en ?? currentCode}
                  </span>
                </div>
                {isPhotoReq && (
                  <span className="text-[10.5px] font-semibold text-sky-400 bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded flex items-center gap-1">
                    <Camera className="w-3 h-3" /> Photo required
                  </span>
                )}
              </div>
            </div>

            {/* Camera / Photo Upload Field */}
            {(isPhotoReq || photo?.previewUrl) && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-sky-400" />
                    <span>સ્ટેજ ફોટો / Stage Photo</span>
                    {isPhotoReq && <span className="text-red-400 font-bold">*</span>}
                  </span>

                  <button
                    type="button"
                    onClick={() => fileInputRefs.current[item.id]?.click()}
                    disabled={photo?.uploading}
                    className="text-xs font-semibold text-sky-400 hover:text-sky-300 bg-sky-500/10 border border-sky-500/30 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>{photo?.previewUrl ? "Change Photo" : "Take / Pick Photo"}</span>
                  </button>
                  <input
                    ref={(el) => { fileInputRefs.current[item.id] = el; }}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileSelected(item.id, f);
                    }}
                  />
                </div>

                {photo?.uploading && (
                  <div className="flex items-center gap-2 text-xs text-sky-400 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Compressing & uploading photo...</span>
                  </div>
                )}

                {photo?.error && (
                  <p className="text-xs font-semibold text-red-400">{photo.error}</p>
                )}

                {photo?.previewUrl && !photo.uploading && (
                  <div className="flex items-center gap-3 pt-1">
                    <img
                      src={photo.previewUrl}
                      alt="Stage photo preview"
                      className="w-16 h-16 object-cover rounded-lg border border-slate-700 shadow-md"
                    />
                    <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                      <Check className="w-4 h-4" />
                      <span>Photo uploaded & linked</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleAdvance(item)}
                disabled={isPending || item.blocked || photo?.uploading || (isPhotoReq && !photo?.mediaId)}
                className="flex-1 bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 py-3 px-4 rounded-xl font-bold text-sm transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPending ? (
                  <span>પ્રક્રિયા ચાલુ છે… / Processing…</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>✓ સ્ટેજ પૂર્ણ / Stage Done</span>
                    <ArrowRight className="w-4 h-4 ml-auto" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleToggleBlock(item.id, item.blocked)}
                disabled={isPending}
                className={`py-3 px-3.5 rounded-xl font-bold text-xs border transition-all flex items-center gap-1.5 shrink-0 ${
                  item.blocked
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                    : "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
                }`}
              >
                <AlertOctagon className="w-4 h-4" />
                <span>{item.blocked ? "Unblock" : "અવરોધ / Block"}</span>
              </button>
            </div>

            {/* Block Modal */}
            {showBlockModal === item.id && (
              <div className="mt-3 p-3.5 bg-red-950/40 border border-red-500/40 rounded-xl space-y-3">
                <span className="text-xs font-bold text-red-300 block">
                  અવરોધનું કારણ લખો / Reason for Blocker
                </span>
                <input
                  type="text"
                  placeholder="e.g. Fabric delayed from vendor..."
                  value={blockNote}
                  onChange={(e) => setBlockNote(e.target.value)}
                  className="w-full bg-slate-950 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowBlockModal(null)}
                    className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => submitBlock(item.id)}
                    disabled={isPending || !blockNote.trim()}
                    className="text-xs font-bold bg-red-500 text-white px-3 py-1.5 rounded-lg hover:bg-red-600 disabled:opacity-50"
                  >
                    Save Blocker
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
