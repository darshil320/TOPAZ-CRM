"use client";

import { useState, useTransition, useOptimistic } from "react";
import Button from "@/components/ui/Button";
import CancelOrderDialog from "./CancelOrderDialog";
import { patchOrderStatus } from "./actions";
import { NEXT_TRANSITIONS } from "./status";

export default function OrderStatusActions({ orderId, status }: { orderId: string; status: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    status,
    (_, nextStatus: string) => nextStatus
  );

  const transitions = NEXT_TRANSITIONS[optimisticStatus] ?? [];
  if (transitions.length === 0) {
    return <p className="text-caption text-t3">No further actions for a {optimisticStatus} order.</p>;
  }

  // Cancel is handled by its own dialog — it needs a reason AND has to show what
  // cancelling costs (a refund owed, goods in transit) before it happens. The forward
  // transitions stay one tap.
  const forward = transitions.filter((t) => t.to !== "cancelled");
  const cancellable = transitions.some((t) => t.to === "cancelled");

  const move = (to: string) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      setOptimisticStatus(to);
      const result = await patchOrderStatus(orderId, to);
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
        {forward.map((t) => (
          <Button key={t.to} variant="primary" onClick={() => move(t.to)} disabled={isPending}>
            {t.label}
          </Button>
        ))}

        {cancellable && (
          <CancelOrderDialog
            orderId={orderId}
            disabled={isPending}
            onCancelled={({ refundDue }) => {
              setOptimisticStatus("cancelled");
              const refund = Number(refundDue ?? 0);
              setNotice(
                refund > 0
                  ? "Order cancelled. Production stopped. A refund is owed on the payment already collected."
                  : "Order cancelled. Production stopped and workshop reminders cleared.",
              );
            }}
          />
        )}
      </div>
      {error && <p className="text-caption font-semibold text-warn mt-1">{error}</p>}
      {notice && <p className="text-caption text-t3 mt-1">{notice}</p>}
    </div>
  );
}
