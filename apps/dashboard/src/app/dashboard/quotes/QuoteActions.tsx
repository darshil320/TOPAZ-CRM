"use client";

import { useState, useTransition, useOptimistic } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteQuote, reviseQuote, sendQuote } from "./actions";
import { createOrderFromQuote } from "../orders/actions";

interface Props {
  quoteId: string;
  status: string;
}

/** Detail-view actions. Edit/Delete are draft-only (the server also enforces
 * this with a 409); Revise clones any quotation into a fresh draft revision. */
export default function QuoteActions({ quoteId, status }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isDraft = status === "draft";

  const isApproved = status === "approved";
  const toOrder = () => {
    setError(null);
    startTransition(async () => {
      const result = await createOrderFromQuote(quoteId);
      if (result.error || !result.id) {
        setError(result.error ?? "Could not create order");
        return;
      }
      router.push(`/dashboard/orders/${result.id}`);
    });
  };

  const revise = () => {
    setError(null);
    startTransition(async () => {
      const result = await reviseQuote(quoteId);
      if (result.error || !result.id) {
        setError(result.error ?? "Could not create revision");
        return;
      }
      router.push(`/dashboard/quotes/${result.id}`);
    });
  };

  const [sent, setSent] = useState(false);
  const [optimisticSent, setOptimisticSent] = useOptimistic(
    sent,
    (_, next: boolean) => next
  );

  const send = () => {
    setError(null);
    startTransition(async () => {
      setOptimisticSent(true);
      const result = await sendQuote(quoteId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSent(true);
      // No refresh: `sendQuote` revalidates this quote's page, so the action's own
      // response carries the fresh tree. See OrderStatusActions for the same note.
    });
  };

  const remove = () => {
    if (!window.confirm("Delete this draft quotation? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteQuote(quoteId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/dashboard/quotes");
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {isApproved && (
          <button
            type="button"
            onClick={toOrder}
            disabled={isPending}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
          >
            {isPending ? "Working…" : "Create order"}
          </button>
        )}
        {isDraft && (
          <button
            type="button"
            onClick={send}
            disabled={isPending || optimisticSent}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
          >
            {optimisticSent ? "Queued ✓" : "Send to customer"}
          </button>
        )}
        {isDraft && (
          <Link
            href={`/dashboard/quotes/${quoteId}/edit`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Edit
          </Link>
        )}
        <button
          type="button"
          onClick={revise}
          disabled={isPending}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 disabled:opacity-60"
        >
          {isPending ? "Working…" : "Revise"}
        </button>
        {isDraft && (
          <button
            type="button"
            onClick={remove}
            disabled={isPending}
            className="rounded-lg px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
          >
            Delete
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
