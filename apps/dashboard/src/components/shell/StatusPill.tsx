"use client";

import { useOptimistic, useTransition } from "react";
import { toggleAvailability } from "@/app/dashboard/actions";

export default function StatusPill({
  salespersonId,
  initialAvailable,
}: {
  salespersonId: string;
  initialAvailable: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [available, setOptimisticAvailable] = useOptimistic(
    initialAvailable,
    (_, next: boolean) => next,
  );

  function handleClick() {
    const next = !available;
    startTransition(async () => {
      setOptimisticAvailable(next);
      const { error } = await toggleAvailability(salespersonId, next);
      if (error) console.error("Availability toggle failed:", error);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={`h-[29px] flex items-center gap-1.5 pl-2 pr-2.5 rounded-pill ${
        available ? "bg-posS text-pos" : "bg-sf2 text-t2"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${available ? "bg-pos" : "bg-t3"}`} />
      <span className="text-[12px] font-560">{available ? "Available" : "Away"}</span>
    </button>
  );
}
