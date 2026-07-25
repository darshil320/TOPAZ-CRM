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
      <div className="flex flex-wrap items-center gap-2.5">
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
                  ? "inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 px-4 py-2.5 text-xs font-bold transition-all active:scale-95 disabled:opacity-60 shadow-2xs"
                  : "inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-2.5 text-xs font-bold transition-all active:scale-95 disabled:opacity-60 shadow-sm shadow-blue-500/20"
              }
            >
              {isPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Working...
                </span>
              ) : (
                t.label
              )}
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs font-bold text-rose-600 mt-1">{error}</p>}
    </div>
  );
}
