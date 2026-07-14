"use client";

import { useState, useTransition } from "react";
import { addMeetingNote } from "./actions";

export type MeetingNote = {
  id: string;
  notes: string | null;
  budget: string | null;
  products: string[] | null;
  stage_at_time: string | null;
  created_at: string;
  salespersons: { name: string } | null;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Append-only per-visit meeting log (the `conversations` table). Each entry
 * captures what was discussed, optional budget + products, and the pipeline
 * stage at the time — the running history behind the one-line interest summary.
 */
export default function MeetingNotes({
  customerId,
  initialNotes,
}: {
  customerId: string;
  initialNotes: MeetingNote[];
}) {
  const [notes, setNotes] = useState<MeetingNote[]>(initialNotes);
  const [text, setText] = useState("");
  const [budget, setBudget] = useState("");
  const [products, setProducts] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAdd = () => {
    if (!text.trim() || isPending) return;
    startTransition(async () => {
      const { error } = await addMeetingNote(customerId, {
        notes: text,
        budget: budget || undefined,
        products: products || undefined,
      });
      if (error) {
        setError(error);
      } else {
        setError(null);
        // Optimistic prepend; server revalidate will reconcile.
        setNotes((prev) => [
          {
            id: `tmp-${prev.length}`,
            notes: text.trim(),
            budget: budget.trim() || null,
            products: products.trim() ? products.split(",").map((p) => p.trim()).filter(Boolean) : null,
            stage_at_time: null,
            created_at: new Date().toISOString(),
            salespersons: null,
          },
          ...prev,
        ]);
        setText("");
        setBudget("");
        setProducts("");
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What was discussed this visit? Preferences, objections, next step…"
          rows={2}
          className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none bg-slate-50 placeholder:text-slate-400"
        />
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="Budget (optional)"
            className="flex-1 text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 placeholder:text-slate-400"
          />
          <input
            value={products}
            onChange={(e) => setProducts(e.target.value)}
            placeholder="Products, comma-separated (optional)"
            className="flex-1 text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 placeholder:text-slate-400"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAdd}
            disabled={!text.trim() || isPending}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {isPending ? "Adding…" : "Add note"}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>

      {/* Timeline */}
      {notes.length === 0 ? (
        <p className="text-sm text-slate-400">No meeting notes yet.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="border-l-2 border-slate-200 pl-3 py-0.5">
              <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.notes}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                {n.budget && (
                  <span className="text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full">₹ {n.budget}</span>
                )}
                {(n.products ?? []).map((p, i) => (
                  <span key={i} className="text-[11px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">{p}</span>
                ))}
                {n.stage_at_time && (
                  <span className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-full">{n.stage_at_time}</span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                {n.salespersons?.name ? `${n.salespersons.name} · ` : ""}{formatDate(n.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
