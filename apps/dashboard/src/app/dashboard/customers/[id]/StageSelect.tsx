"use client";

import { useState } from "react";
import { moveStage } from "./actions";

const STAGES = [
  { id: "new", label: "New", inactive: "hover:border-slate-400 text-slate-600", active: "bg-slate-700 text-white border-slate-700" },
  { id: "talking", label: "Talking", inactive: "hover:border-blue-400 text-slate-600", active: "bg-blue-600 text-white border-blue-600" },
  { id: "follow_up", label: "Follow-up", inactive: "hover:border-amber-400 text-slate-600", active: "bg-amber-500 text-white border-amber-500" },
  { id: "won", label: "Won", inactive: "hover:border-green-400 text-slate-600", active: "bg-green-600 text-white border-green-600" },
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
