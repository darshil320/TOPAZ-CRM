"use client";

import { useOptimistic, useTransition } from "react";
import { toggleAvailability } from "@/app/dashboard/actions";

interface Props {
  salespersonId: string;
  initialAvailable: boolean;
}

export default function AvailabilityToggle({ salespersonId, initialAvailable }: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimisticAvailable, setOptimisticAvailable] = useOptimistic(
    initialAvailable,
    (_, next: boolean) => next
  );

  const handleToggle = () => {
    const next = !optimisticAvailable;
    startTransition(async () => {
      setOptimisticAvailable(next);
      const { error } = await toggleAvailability(salespersonId, next);
      if (error) console.error("Availability toggle failed:", error);
    });
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-sm font-medium border transition-colors select-none ${
        optimisticAvailable
          ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200/80"
          : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200/80"
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full transition-colors ${
          optimisticAvailable ? "bg-green-500 animate-pulse" : "bg-slate-400"
        }`}
      />
      <span>{optimisticAvailable ? "Available" : "Away"}</span>
    </button>
  );
}
