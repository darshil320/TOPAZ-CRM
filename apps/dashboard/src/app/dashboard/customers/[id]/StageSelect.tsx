"use client";

import { useState } from "react";
import { moveStage } from "./actions";

const STAGES = [
  { id: "new", label: "New" },
  { id: "talking", label: "Talking" },
  { id: "follow_up", label: "Follow Up" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
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
    setActive(stageId); // optimistic
    setError(null);
    setPending(true);
    const { error: err } = await moveStage(customerId, stageId);
    if (err) {
      setActive(prev); // revert
      setError(err);
    }
    setPending(false);
  }

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1 snap-x scrollbar-hide">
        {STAGES.map((s) => {
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              onClick={() => handleClick(s.id)}
              disabled={pending}
              className={[
                "snap-start shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-blue-400",
                pending ? "opacity-60 cursor-not-allowed" : "",
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
