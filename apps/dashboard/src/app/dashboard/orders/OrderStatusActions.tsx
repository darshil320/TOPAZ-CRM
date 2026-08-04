"use client";

import { useState, useTransition, useOptimistic } from "react";
import Button from "@/components/ui/Button";
import { patchOrderStatus } from "./actions";
import { NEXT_TRANSITIONS, REASON_REQUIRED } from "./status";

export default function OrderStatusActions({ orderId, status }: { orderId: string; status: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    status,
    (_, nextStatus: string) => nextStatus
  );

  const transitions = NEXT_TRANSITIONS[optimisticStatus] ?? [];
  if (transitions.length === 0) {
    return <p className="text-caption text-t3">No further actions for a {optimisticStatus} order.</p>;
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
      setOptimisticStatus(to);
      const result = await patchOrderStatus(orderId, to, reason);
      if (result.error) setError(result.error);
      // NO router.refresh() ON SUCCESS. `patchOrderStatus` calls revalidatePath for
      // this page, so Next already ships the re-rendered tree in the action's own
      // response. Calling refresh() as well fired a SECOND request that re-ran every
      // query on the order page — the whole detail render, twice, per tap.
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
              {t.label}
            </Button>
          );
        })}
      </div>
      {error && <p className="text-caption font-semibold text-warn mt-1">{error}</p>}
    </div>
  );
}
