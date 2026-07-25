"use client";

import { useState, useTransition } from "react";
import { addMeetingNote } from "./actions";
import Button from "@/components/ui/Button";
import Pill from "@/components/ui/Pill";

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
      <div className="bg-sf2 border border-ln rounded-card p-3.5 space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What was discussed this visit? Preferences, objections, next steps..."
          rows={2}
          className="w-full text-ui font-medium border border-ln rounded-md p-2.5 focus:outline-none focus:border-acc resize-none bg-sf text-t1 placeholder-t3"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="Budget (e.g. 1.5L)"
            className="text-ui font-medium border border-ln rounded-md px-3 py-1.5 focus:outline-none focus:border-acc bg-sf text-t1 font-mono placeholder-t3"
          />
          <input
            value={products}
            onChange={(e) => setProducts(e.target.value)}
            placeholder="Products (e.g. Sofa, Dining)"
            className="text-ui font-medium border border-ln rounded-md px-3 py-1.5 focus:outline-none focus:border-acc bg-sf text-t1 placeholder-t3"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          {error ? <span className="text-caption text-warn">{error}</span> : <div />}
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!text.trim() || isPending}
          >
            {isPending ? "Saving..." : "Add Note"}
          </Button>
        </div>
      </div>

      {/* Timeline entries */}
      {notes.length === 0 ? (
        <div className="py-6 text-center text-caption text-t3 font-medium">
          No meeting notes recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="bg-sf rounded-card border border-ln p-3.5 shadow-sh space-y-2">
              <p className="text-ui font-medium text-t1 leading-relaxed whitespace-pre-wrap">{n.notes}</p>

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {n.budget && (
                  <Pill tone="warn" dot={false}>
                    ₹ {n.budget}
                  </Pill>
                )}
                {(n.products ?? []).map((p, i) => (
                  <Pill key={i} tone="pos" dot={false}>
                    {p}
                  </Pill>
                ))}
                {n.stage_at_time && (
                  <Pill tone="neutral" dot={false}>
                    {n.stage_at_time}
                  </Pill>
                )}
              </div>

              <div className="flex items-center justify-between text-caption text-t3 pt-1 border-t border-ln2">
                <span>{n.salespersons?.name ? `Logged by ${n.salespersons.name}` : "System Log"}</span>
                <span className="font-mono">{formatDate(n.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
