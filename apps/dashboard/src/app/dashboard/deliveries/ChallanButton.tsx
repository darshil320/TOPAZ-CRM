"use client";

/**
 * Generate / download one CONSIGNMENT's challan (0037, per-consignment since 0040).
 *
 * One button per recipient on the run, not one per run: a mixed-customer lorry produces two
 * documents, and a single button would silently hand one customer the other's paperwork.
 * `recipientName` is rendered when a run has more than one, so the two buttons are
 * distinguishable at a glance.
 *
 * Rendering is a queued headless-browser job, so this polls for the PDF rather than
 * blocking on a request that would time out. A 404 from the URL endpoint is the expected
 * state while the worker is still going — it is not surfaced as an error until the poll
 * budget runs out, at which point the honest message is "still rendering", because the
 * task retries and the document will appear.
 */

import { useState, useTransition } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { generateChallanAction, getChallanUrlAction } from "./challanActions";

// ~15s of polling. Long enough for a cold Playwright start, short enough that the button
// does not spin forever if the worker is down.
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function ChallanButton({
  consignmentId,
  orderIds,
  challanNo,
  recipientName,
}: {
  consignmentId: string;
  /** Every order this challan covers — for cache revalidation after a render. */
  orderIds?: string[];
  /** Non-null once a number has been allocated — i.e. it has been generated before. */
  challanNo?: string | null;
  /** Shown only when the run has more than one recipient. */
  recipientName?: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function open(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  /** Try the existing PDF first — a re-download must not re-render. */
  function handleClick() {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const existing = await getChallanUrlAction(consignmentId);
      if (existing.url) {
        open(existing.url);
        return;
      }

      setStatus("Generating…");
      const queued = await generateChallanAction(consignmentId, orderIds);
      if (queued.error) {
        setStatus(null);
        setError(queued.error);
        return;
      }

      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        const ready = await getChallanUrlAction(consignmentId);
        if (ready.url) {
          setStatus(null);
          open(ready.url);
          return;
        }
      }
      setStatus(null);
      setError("Still rendering — try Download again in a moment.");
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-card border border-ln bg-sf2 px-2.5 py-1 text-caption font-semibold text-t2 hover:bg-sf3 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : challanNo ? (
          <Download className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <FileText className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        <span>
          {status ?? (challanNo ? "Challan" : "Generate challan")}
          {recipientName ? ` · ${recipientName}` : ""}
        </span>
      </button>
      {challanNo && !error && (
        <span className="font-mono text-[10.5px] tabular-nums text-t3">{challanNo}</span>
      )}
      {error && <span className="max-w-[14rem] text-[10.5px] text-warn">{error}</span>}
    </div>
  );
}
