"use client";

import { useState, useTransition } from "react";
import { updateInterestSummary } from "./actions";

interface Props {
  customerId: string;
  initialSummary: string | null;
}

/**
 * A living free-text summary of what the customer wants — seeded at the kiosk,
 * kept current here by the owner or the assigned salesperson. Shown first thing
 * so a repeat arrival is instantly readable ("wanted a fabric recliner, ~₹1.5L").
 */
export default function InterestSummary({ customerId, initialSummary }: Props) {
  const [value, setValue] = useState(initialSummary ?? "");
  const [saved, setSaved] = useState(initialSummary ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirty = value.trim() !== saved.trim();

  const handleSave = () => {
    startTransition(async () => {
      const { error } = await updateInterestSummary(customerId, value);
      if (error) {
        setError(error);
      } else {
        setError(null);
        setSaved(value);
      }
    });
  };

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What is this customer looking for? Budget, style, room, timeline…"
        rows={3}
        className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none bg-slate-50 placeholder:text-slate-400"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || isPending}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {isPending ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
