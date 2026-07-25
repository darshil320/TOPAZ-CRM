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
      {/* Add note card */}
      <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 space-y-3 shadow-2xs">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What was discussed this visit? Preferences, objections, next steps..."
          rows={2}
          className="w-full text-xs font-medium border border-slate-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none bg-white placeholder:text-slate-400"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="Budget (e.g. 1.5L)"
            className="text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white placeholder:text-slate-400"
          />
          <input
            value={products}
            onChange={(e) => setProducts(e.target.value)}
            placeholder="Products (e.g. Sofa, Dining)"
            className="text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          {error ? <span className="text-xs font-semibold text-rose-600">{error}</span> : <div />}
          <button
            type="button"
            onClick={handleAdd}
            disabled={!text.trim() || isPending}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-all active:scale-95"
          >
            {isPending ? "Saving..." : "Add Note"}
          </button>
        </div>
      </div>

      {/* Timeline entries */}
      {notes.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400 font-medium">
          No meeting notes recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs space-y-2">
              <p className="text-xs font-medium text-slate-800 leading-relaxed whitespace-pre-wrap">{n.notes}</p>

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {n.budget && (
                  <span className="text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-md">
                    ₹ {n.budget}
                  </span>
                )}
                {(n.products ?? []).map((p, i) => (
                  <span key={i} className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md">
                    {p}
                  </span>
                ))}
                {n.stage_at_time && (
                  <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                    {n.stage_at_time}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold pt-1 border-t border-slate-100">
                <span>{n.salespersons?.name ? `Logged by ${n.salespersons.name}` : "System Log"}</span>
                <span>{formatDate(n.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
