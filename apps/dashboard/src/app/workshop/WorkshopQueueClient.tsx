"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, AlertOctagon, Camera, ArrowRight, Clock, ShieldAlert, Sparkles } from "lucide-react";
import { advanceStageAction, toggleBlockAction } from "./actions";
import type { WorkshopQueueItem, StageDef } from "./page";

export default function WorkshopQueueClient({
  initialItems,
  stages,
}: {
  initialItems: WorkshopQueueItem[];
  stages: StageDef[];
}) {
  const [items, setItems] = useState<WorkshopQueueItem[]>(initialItems);
  const [isPending, startTransition] = useTransition();
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [blockNote, setBlockNote] = useState("");
  const [showBlockModal, setShowBlockModal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageMap = new Map(stages.map((s) => [s.code, s]));
  const firstStageCode = stages[0]?.code ?? "design_approved";

  function handleAdvance(item: WorkshopQueueItem) {
    setError(null);
    const currentCode = item.current_stage || firstStageCode;
    const currentDef = stageMap.get(currentCode);

    startTransition(async () => {
      const res = await advanceStageAction(item.id);
      if (res.error) {
        setError(res.error);
        return;
      }
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

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleAdvance(item)}
                disabled={isPending || item.blocked}
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
