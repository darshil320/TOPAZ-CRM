"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { patchOrderStatus } from "./actions";
import { NEXT_TRANSITIONS, REASON_REQUIRED } from "./status";

export default function OrderStatusActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const transitions = NEXT_TRANSITIONS[status] ?? [];
  if (transitions.length === 0) {
    return <p className="text-caption text-t3">No further actions for a {status} order.</p>;
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
      <div className="flex flex-wrap items-center gap-2">
        {transitions.map((t) => {
          const danger = t.to === "cancelled";
          return (
            <Button
              key={t.to}
              variant={danger ? "secondary" : "primary"}
              onClick={() => move(t.to)}
              disabled={isPending}
              className={danger ? "border-warn/30 text-warn hover:bg-warnS" : undefined}
            >
              {isPending ? "Working..." : t.label}
            </Button>
          );
        })}
      </div>
      {error && <p className="text-caption font-semibold text-warn mt-1">{error}</p>}
    </div>
  );
}
