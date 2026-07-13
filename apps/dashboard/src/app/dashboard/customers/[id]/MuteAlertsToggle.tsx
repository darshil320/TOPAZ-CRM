"use client";

import { useOptimistic, useTransition } from "react";
import { setAlertsMuted } from "./actions";

interface Props {
  customerId: string;
  initialMuted: boolean;
}

/**
 * Owner-only switch to silence arrival alerts + AI drafts for a known regular
 * (staff, family, the water-delivery person). Their visits are still recorded;
 * only the notification is suppressed. The DB trigger enforces owner-only too.
 */
export default function MuteAlertsToggle({ customerId, initialMuted }: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimisticMuted, setOptimisticMuted] = useOptimistic(
    initialMuted,
    (_, next: boolean) => next,
  );

  const handleToggle = () => {
    const next = !optimisticMuted;
    startTransition(async () => {
      setOptimisticMuted(next);
      const { error } = await setAlertsMuted(customerId, next);
      if (error) console.error("Mute toggle failed:", error);
    });
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-700">
          {optimisticMuted ? "Arrival alerts muted" : "Arrival alerts on"}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          {optimisticMuted
            ? "No alert or AI draft when this person arrives — visits still logged."
            : "The primary salesperson is alerted each time this person arrives."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={optimisticMuted}
        onClick={handleToggle}
        disabled={isPending}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          optimisticMuted ? "bg-slate-400" : "bg-green-500"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            optimisticMuted ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
