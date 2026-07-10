"use client";

import { useOptimistic, useTransition } from "react";
import { setSalespersonActive } from "./actions";

interface Props {
  salespersonId: string;
  initialActive: boolean;
}

export default function ActiveToggle({ salespersonId, initialActive }: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimisticActive, setOptimisticActive] = useOptimistic(
    initialActive,
    (_, next: boolean) => next,
  );

  const handleToggle = () => {
    const next = !optimisticActive;
    startTransition(async () => {
      setOptimisticActive(next);
      const { error } = await setSalespersonActive(salespersonId, next);
      if (error) console.error("Active toggle failed:", error);
    });
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors select-none ${
        optimisticActive
          ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200/80"
          : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200/80"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${optimisticActive ? "bg-green-500" : "bg-slate-400"}`} />
      {optimisticActive ? "Active" : "Deactivated"}
    </button>
  );
}
