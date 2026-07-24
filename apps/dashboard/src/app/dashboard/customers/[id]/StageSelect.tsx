"use client";

import { useState } from "react";
import { moveStage } from "./actions";

const STAGES = [
  { id: "inquiry", label: "Inquiry", inactive: "hover:border-slate-400 text-slate-600", active: "bg-slate-700 text-white border-slate-700" },
  { id: "contacted", label: "Contacted", inactive: "hover:border-blue-400 text-slate-600", active: "bg-blue-600 text-white border-blue-600" },
  { id: "visit_scheduled", label: "Visit Scheduled", inactive: "hover:border-indigo-400 text-slate-600", active: "bg-indigo-600 text-white border-indigo-600" },
  { id: "walk_in", label: "Walk-in", inactive: "hover:border-cyan-400 text-slate-600", active: "bg-cyan-600 text-white border-cyan-600" },
  { id: "design_discussion", label: "Design", inactive: "hover:border-violet-400 text-slate-600", active: "bg-violet-600 text-white border-violet-600" },
  { id: "quotation_sent", label: "Quote Sent", inactive: "hover:border-amber-400 text-slate-600", active: "bg-amber-500 text-white border-amber-500" },
  { id: "negotiation", label: "Negotiation", inactive: "hover:border-orange-400 text-slate-600", active: "bg-orange-500 text-white border-orange-500" },
  { id: "order_confirmed", label: "Order Confirmed", inactive: "hover:border-green-400 text-slate-600", active: "bg-green-600 text-white border-green-600" },
  { id: "lost", label: "Lost", inactive: "hover:border-red-400 text-slate-600", active: "bg-red-500 text-white border-red-500" },
] as const;

export default function StageSelect({
  customerId,
  currentStage,
}: {
  customerId: string;
  currentStage: string;
}) {
  const [active, setActive] = useState(currentStage);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleClick(stageId: string) {
    if (stageId === active || pending) return;
    const prev = active;
    setActive(stageId);
    setError(null);
    setPending(true);
    const { error: err } = await moveStage(customerId, stageId);
    if (err) { setActive(prev); setError(err); }
    setPending(false);
  }

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        {STAGES.map((s) => {
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              onClick={() => handleClick(s.id)}
              disabled={pending}
              className={[
                "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all",
                isActive ? s.active : `bg-white border-slate-200 ${s.inactive}`,
                pending ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
