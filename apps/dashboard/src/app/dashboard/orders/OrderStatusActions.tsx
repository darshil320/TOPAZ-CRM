"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { patchOrderStatus } from "./actions";
import { NEXT_TRANSITIONS, REASON_REQUIRED } from "./status";

export default function OrderStatusActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const transitions = NEXT_TRANSITIONS[status] ?? [];
  if (transitions.length === 0) {
    return <p className="text-sm text-slate-400">No further actions for a {status} order.</p>;
  }

  const move = (to: string) => {
    setError(null);
    let reason: string | undefined;
    if (REASON_REQUIRED.has(to)) {
      const input = window.prompt("Reason for cancelling this order?");
      if (input == null || !input.trim()) return; // cancelled the prompt
      reason = input.trim();
    }
    startTransition(async () => {
      const result = await patchOrderStatus(orderId, to, reason);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => {
          const danger = t.to === "cancelled";
          return (
            <button
              key={t.to}
              type="button"
              onClick={() => move(t.to)}
              disabled={isPending}
              className={
                danger
                  ? "rounded-lg px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
                  : "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
              }
            >
              {isPending ? "Working…" : t.label}
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
