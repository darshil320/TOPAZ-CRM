"use client";

/**
 * My Queue — one card per item at this workshop.
 *
 * Module 14 added four things to each card, all of which the client asked for:
 *   · **the deadline with a TIME** (`leg_due_at`), plus a live "in 2 days / 3 days late"
 *     chip that turns amber inside a day and red past it;
 *   · **the leg badge** — "Leg 1 / 2 · પોલિશિંગ" and where it goes next;
 *   · **the transit lock** — an item on a lorry renders read-only, because a stage tap
 *     on goods nobody can see means nothing (the API 409s it anyway);
 *   · **hand over** — lead-only, for handing off early. Finishing the leg's last stage
 *     does it automatically, so this button exists for the lorry that is leaving now.
 */

import { useMemo, useState, useTransition } from "react";
import {
  AlertOctagon,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  MapPin,
  Send,
  ShieldAlert,
  Sparkles,
  Truck,
} from "lucide-react";
import CameraField from "@/components/production/CameraField";
import { usePhotoCapture } from "@/components/production/usePhotoCapture";
import { describeDue, legLabel, spanLabel } from "@/lib/production/format";
import type { QueueItem, StageDef, WorkshopMembership } from "@/lib/production/types";
import { advanceStageAction, handoverAction, toggleBlockAction } from "./actions";

const TONE_STYLES: Record<string, string> = {
  ok: "text-slate-300 bg-slate-800/60 border-slate-700",
  soon: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  overdue: "text-red-300 bg-red-500/15 border-red-500/40",
  none: "text-slate-500 bg-slate-800/40 border-slate-800",
};

export default function WorkshopQueueClient({
  initialItems,
  stages,
  workshops,
}: {
  initialItems: QueueItem[];
  stages: StageDef[];
  workshops: WorkshopMembership[];
}) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blockNote, setBlockNote] = useState("");
  const [showBlockModal, setShowBlockModal] = useState<string | null>(null);

  const photos = usePhotoCapture({ entityType: "order_item", kind: "production" });

  const stageMap = useMemo(() => new Map(stages.map((s) => [s.code, s])), [stages]);
  const firstStageCode = stages[0]?.code ?? "design_approved";

  /** Custody actions are lead-only, per workshop (module 14 D4). */
  const leadAt = useMemo(
    () => new Set(workshops.filter((w) => w.staff_role === "lead").map((w) => w.id)),
    [workshops],
  );

  function handleAdvance(item: QueueItem) {
    setError(null);
    setNotice(null);
    const currentCode = item.current_stage || firstStageCode;
    const currentDef = stageMap.get(currentCode);
    const photoRequired = currentDef?.photo_required ?? false;
    const photo = photos.slot(item.id);

    if (photoRequired && !photo.mediaId) {
      setError(
        `📷 ${currentDef?.label_gu || currentDef?.label_en || "આ"} સ્ટેજ માટે ફોટો ફરજિયાત છે / Photo required for this stage`,
      );
      return;
    }

    startTransition(async () => {
      const res = await advanceStageAction(
        item.id,
        undefined,
        photo.mediaId || undefined,
        currentCode,
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      photos.clear(item.id);

      if (res.transfer) {
        // The leg finished and a consignment opened itself. Drop the card: the goods
        // are no longer this workshop's problem, and leaving it visible would invite a
        // tap the API would refuse.
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setNotice(
          `📦 ${res.transfer.transfer_no} — માલ મોકલવા તૈયાર / ready to send. ` +
            `A driver will collect it.`,
        );
        return;
      }
      if (res.done) {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setNotice("✅ છેલ્લું સ્ટેજ પૂર્ણ / Final stage complete.");
        return;
      }
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, current_stage: res.nextStage ?? i.current_stage } : i,
        ),
      );
    });
  }

  function handleToggleBlock(itemId: string, currentlyBlocked: boolean) {
    if (!currentlyBlocked) {
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
      setError("અવરોધનું કારણ લખો / Type a reason for the blocker");
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

  function handleHandover(item: QueueItem) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await handoverAction([item.id]);
      if (res.error) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setNotice(`📦 ${res.transferNo} — માલ મોકલવા તૈયાર / ready to send.`);
    });
  }

  if (items.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
        <h3 className="text-base font-bold text-white">કોઈ કામ બાકી નથી / All caught up!</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">
          Nothing is waiting for production at your workshop right now.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs font-semibold text-red-400 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs font-semibold text-emerald-300 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {items.map((item) => {
        const currentCode = item.current_stage || firstStageCode;
        const currentDef = stageMap.get(currentCode);
        const currentIndex = stages.findIndex((s) => s.code === currentCode);
        const stageNum = currentIndex >= 0 ? currentIndex + 1 : 1;
        const photoRequired = currentDef?.photo_required ?? false;
        const photo = photos.slot(item.id);

        const due = describeDue(item.leg_due_at ?? item.due_at);
        const inTransit = item.transit_transfer_id !== null;
        const isLead = leadAt.has(item.workshop_id);
        const leg = legLabel(item.leg_seq, item.leg_total);
        const span = spanLabel(item.leg_stage_from, item.leg_stage_to, stages);
        // The leg's last stage is done once the item has moved PAST it — the trigger
        // advances current_stage on completion, so "sort(current) > sort(stage_to)".
        const legStageToIndex = item.leg_stage_to
          ? stages.findIndex((s) => s.code === item.leg_stage_to)
          : -1;
        const legFinished = legStageToIndex >= 0 && currentIndex > legStageToIndex;
        const canHandOver = isLead && !inTransit && legFinished && !!item.next_workshop_name;

        return (
          <div
            key={item.id}
            className={`rounded-2xl border p-4 sm:p-5 transition-all space-y-4 ${
              item.blocked
                ? "bg-red-950/20 border-red-500/40"
                : inTransit
                  ? "bg-sky-950/20 border-sky-500/40"
                  : due.overdue
                    ? "bg-red-950/10 border-red-500/30"
                    : "bg-slate-900 border-slate-800 hover:border-slate-700 shadow-xl"
            }`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 rounded">
                    {item.order_no}
                  </span>
                  <span className="text-xs font-semibold text-slate-300">{item.customer_name}</span>
                  {item.blocked && (
                    <span className="text-[11px] font-bold text-red-400 bg-red-500/20 border border-red-500/30 px-2 py-0.5 rounded flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" /> અવરોધિત / BLOCKED
                    </span>
                  )}
                  {inTransit && (
                    <span className="text-[11px] font-bold text-sky-300 bg-sky-500/20 border border-sky-500/30 px-2 py-0.5 rounded flex items-center gap-1">
                      <Truck className="w-3 h-3" /> રસ્તામાં / IN TRANSIT
                    </span>
                  )}
                </div>
                <h3 className="text-base font-extrabold text-white">{item.description}</h3>
                <p className="text-xs text-slate-400 font-mono">
                  {item.qty} {item.unit || "nos"}
                  {item.dimensions && ` · ${item.dimensions}`}
                  {item.material && ` · ${item.material}`}
                </p>
                {item.spec_notes && (
                  <p className="text-[11px] text-slate-400 leading-relaxed border-l-2 border-slate-700 pl-2">
                    {item.spec_notes}
                  </p>
                )}
              </div>

              <div className="text-right shrink-0 space-y-1">
                <span className="text-[10px] font-mono font-semibold text-slate-400 block uppercase">
                  {item.workshop_name}
                </span>
                <span className="text-[11px] font-bold text-amber-400 block">
                  {stageNum} / {stages.length}
                </span>
                {leg && (
                  <span className="text-[10px] font-mono text-slate-500 block">{leg}</span>
                )}
              </div>
            </div>

            {/* Deadline — date AND time, the client's explicit ask */}
            <div
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${TONE_STYLES[due.tone]}`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  પહોંચાડવાનું / Due: <span className="font-mono">{due.label}</span>
                </span>
              </span>
              <span className="font-mono text-[11px] shrink-0">{due.relative}</span>
            </div>

            {/* Route: what this workshop owns, and where it goes next */}
            {(span || item.next_workshop_name) && (
              <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                {span && <span className="font-semibold text-slate-300">{span}</span>}
                {item.next_workshop_name && (
                  <span className="flex items-center gap-1 text-sky-300 font-semibold">
                    <ArrowRight className="w-3 h-3" />
                    {item.next_workshop_name}
                  </span>
                )}
              </div>
            )}

            {/* Stage progress */}
            <div className="space-y-1.5">
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden flex">
                <div
                  className={`h-full transition-all duration-500 ${
                    item.blocked
                      ? "bg-red-500"
                      : inTransit
                        ? "bg-sky-500"
                        : "bg-gradient-to-r from-amber-500 to-amber-400"
                  }`}
                  style={{ width: `${(stageNum / stages.length) * 100}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs pt-1 gap-2">
                <div className="flex items-center gap-1.5 font-bold text-amber-400 min-w-0">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {currentDef?.label_gu ? `${currentDef.label_gu} / ` : ""}
                    {currentDef?.label_en ?? currentCode}
                  </span>
                </div>
                {photoRequired && !inTransit && (
                  <span className="text-[10.5px] font-semibold text-sky-400 bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                    <Camera className="w-3 h-3" /> Photo required
                  </span>
                )}
              </div>
            </div>

            {inTransit ? (
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-200 leading-relaxed">
                આ માલ બીજા વર્કશોપ જઈ રહ્યો છે. પહોંચ્યા પછી ત્યાંના મુખ્ય મેનેજર સ્વીકારશે.
                <br />
                <span className="text-sky-300/80">
                  These goods are on their way to another workshop. Stage updates resume once
                  the destination lead receives them.
                </span>
              </div>
            ) : (
              <>
                {(photoRequired || photo.previewUrl) && (
                  <CameraField
                    slotId={item.id}
                    entityId={item.id}
                    label="સ્ટેજ ફોટો / Stage photo"
                    required={photoRequired}
                    photo={photo}
                    onFile={photos.upload}
                    openCamera={photos.openCamera}
                    setInputRef={photos.setInputRef}
                  />
                )}

                <div className="flex items-center gap-2 pt-1">
                  {canHandOver ? (
                    <button
                      type="button"
                      onClick={() => handleHandover(item)}
                      disabled={isPending}
                      className="flex-1 bg-sky-500 hover:bg-sky-400 active:scale-[0.99] text-slate-950 py-3 px-4 rounded-xl font-bold text-sm transition-all shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <Send className="w-4 h-4" />
                      <span>
                        📦 મોકલો / Hand over to {item.next_workshop_name}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAdvance(item)}
                      disabled={
                        isPending ||
                        item.blocked ||
                        photo.uploading ||
                        (photoRequired && !photo.mediaId)
                      }
                      className="flex-1 bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 py-3 px-4 rounded-xl font-bold text-sm transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isPending ? (
                        <span>પ્રક્રિયા ચાલુ છે… / Working…</span>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>✓ સ્ટેજ પૂર્ણ / Stage done</span>
                          <ArrowRight className="w-4 h-4 ml-auto" />
                        </>
                      )}
                    </button>
                  )}

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
                    <span>{item.blocked ? "ખોલો / Unblock" : "અવરોધ / Block"}</span>
                  </button>
                </div>

                {legFinished && !canHandOver && item.next_workshop_name && !isLead && (
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    આ લેગ પૂરો થયો — મુખ્ય મેનેજર માલ મોકલશે.{" "}
                    <span className="text-slate-500">
                      This leg is finished; your workshop lead hands the goods over.
                    </span>
                  </p>
                )}
              </>
            )}

            {showBlockModal === item.id && (
              <div className="mt-1 p-3.5 bg-red-950/40 border border-red-500/40 rounded-xl space-y-3">
                <span className="text-xs font-bold text-red-300 block">
                  અવરોધનું કારણ લખો / Reason for the blocker
                </span>
                <input
                  type="text"
                  placeholder="દા.ત. કાપડ આવ્યું નથી / e.g. fabric delayed from vendor"
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
                    રદ / Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => submitBlock(item.id)}
                    disabled={isPending || !blockNote.trim()}
                    className="text-xs font-bold bg-red-500 text-white px-3 py-1.5 rounded-lg hover:bg-red-600 disabled:opacity-50"
                  >
                    સેવ / Save blocker
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
