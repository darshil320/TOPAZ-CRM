"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteQuote, reviseQuote } from "./actions";

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

  const revise = () => {
    setError(null);
    startTransition(async () => {
      const result = await reviseQuote(quoteId);
      if (result.error || !result.id) {
        setError(result.error ?? "Could not create revision");
        return;
      }
      router.push(`/dashboard/quotes/${result.id}`);
      router.refresh();
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
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
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
