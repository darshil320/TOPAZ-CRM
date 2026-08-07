"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, X } from "lucide-react";
import Button, { IconButton } from "@/components/ui/Button";
import { formatINR } from "@/lib/format";
import { getCancellationPreview, patchOrderStatus, type CancellationPreview } from "./actions";

const FIELD =
  "w-full rounded-md border border-ln bg-sf2 px-3 py-2 text-[12.5px] text-t1 font-medium focus:border-acc focus:bg-sf focus:outline-none transition-all";

/**
 * Cancel an order, with its consequences shown BEFORE the operator commits.
 *
 * Replaces a `window.prompt("Reason for cancelling this order?")`. A prompt was the
 * wrong control for this: cancelling can be blocked by goods in transit, and it
 * frequently means the business owes a refund on an advance already collected. Neither
 * fact is visible in a prompt, so the operator learned about them afterwards — or not
 * at all.
 *
 * The preview is fetched when the dialog opens (read-only, `/cancellation-preview`), so
 * the blockers and the refund figure are on screen next to the confirm button. The API
 * re-checks everything on submit; this is disclosure, not enforcement.
 */
export default function CancelOrderDialog({
  orderId,
  onCancelled,
  disabled = false,
}: {
  orderId: string;
  /** Called after a successful cancel so the parent can settle its optimistic state. */
  onCancelled?: (summary: { refundDue?: string }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<CancellationPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingPreview(true);
    setError(null);
    getCancellationPreview(orderId)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        if (result.error) setError(result.error);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  function close() {
    setOpen(false);
    setReason("");
    setPreview(null);
    setError(null);
  }

  function submit() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A reason is required to cancel an order.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await patchOrderStatus(orderId, "cancelled", trimmed);
      if (result.error) {
        setError(result.error);
        return;
      }
      onCancelled?.({ refundDue: result.refundDue });
      close();
    });
  }

  const refund = Number(preview?.refundDue ?? 0);
  const blockers = preview?.blockers ?? [];
  const blocked = blockers.length > 0;

  return (
    <>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="border-warn/30 text-warn hover:bg-warnS"
      >
        Cancel order
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-sf rounded-pop border border-ln shadow-shp max-w-lg w-full p-6 space-y-4 my-8 animate-popIn">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warn" strokeWidth={2} />
                <h2 className="text-nav font-semibold text-t1">Cancel this order?</h2>
              </div>
              <IconButton aria-label="Close" onClick={close}>
                <X className="w-4 h-4" />
              </IconButton>
            </div>

            {loadingPreview ? (
              <p className="text-caption text-t3">Checking the order…</p>
            ) : (
              <>
                {blocked && (
                  <div className="rounded-card border border-warn/30 bg-warnS p-3 space-y-1">
                    <p className="text-caption font-semibold text-warn">
                      This order cannot be cancelled yet
                    </p>
                    {blockers.map((b) => (
                      <p key={b} className="text-caption text-warn">
                        {b}
                      </p>
                    ))}
                  </div>
                )}

                {!blocked && (
                  <div className="rounded-card border border-ln bg-sf2 p-3 space-y-1.5">
                    <p className="text-caption text-t2">
                      Production stops: workshops assigned to this order are released and
                      their stage reminders are cancelled.
                    </p>
                    {refund > 0 && (
                      <p className="text-caption font-semibold text-warn">
                        {formatINR(refund)} has already been collected — a refund will be
                        owed. Payments are never deleted; record the refund from the
                        payments section.
                      </p>
                    )}
                    {(preview?.deliveredItems ?? 0) > 0 && (
                      <p className="text-caption text-warn">
                        {preview?.deliveredItems} of {preview?.totalItems} item(s) have
                        already been delivered to the customer.
                      </p>
                    )}
                    <p className="text-caption text-t3">This cannot be undone.</p>
                  </div>
                )}

                <div className="space-y-1">
                  <label htmlFor="cancel-reason" className="text-label-sm uppercase text-t3">
                    Reason (recorded on the order)
                  </label>
                  <textarea
                    id="cancel-reason"
                    className={FIELD}
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Customer changed their mind; site not ready"
                    disabled={blocked}
                  />
                </div>
              </>
            )}

            {error && <p className="text-caption font-semibold text-warn">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={close} disabled={isPending}>
                Keep order
              </Button>
              <Button
                variant="primary"
                onClick={submit}
                disabled={isPending || loadingPreview || blocked || !reason.trim()}
                className="bg-warn hover:opacity-90"
              >
                {isPending ? "Cancelling…" : "Cancel order"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
