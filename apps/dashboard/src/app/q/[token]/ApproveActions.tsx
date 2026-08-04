"use client";

import { useState, useTransition } from "react";
import { decideQuoteAction } from "./actions";

interface Props {
  token: string;
  initialStatus: string;
}

const DECIDED = new Set(["approved", "rejected"]);

/** Customer-facing approve / request-changes buttons. The decision goes through
 * a same-origin server action (see actions.ts for why it is not a direct call
 * to the API). Idempotent server-side, so a retry after a timeout is safe. */
export default function ApproveActions({ token, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (approve: boolean) => {
    setError(null);
    startTransition(async () => {
      const result = await decideQuoteAction(token, approve);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStatus(result.status ?? (approve ? "approved" : "rejected"));
    });
  };

  if (DECIDED.has(status)) {
    const approved = status === "approved";
    return (
      <div
        className={`rounded-xl border p-4 text-center text-sm font-medium ${
          approved
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
        }`}
      >
        {approved
          ? "✓ Thank you — your quotation is confirmed. Our team will be in touch."
          : "Noted — we'll revise this and get back to you shortly."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => decide(true)}
          disabled={isPending}
          className="flex-1 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
        >
          {isPending ? "Please wait…" : "Approve quotation"}
        </button>
        <button
          type="button"
          onClick={() => decide(false)}
          disabled={isPending}
          className="flex-1 rounded-xl border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 disabled:opacity-60"
        >
          Request changes
        </button>
      </div>
      {error && <p className="text-center text-xs text-red-600">{error}</p>}
    </div>
  );
}
