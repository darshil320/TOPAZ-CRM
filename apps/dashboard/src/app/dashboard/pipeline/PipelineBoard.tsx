"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { moveCustomerStage } from "./actions";

export interface BoardCard {
  customerId: string;
  name: string;
  subtitle: string | null;
  stage: string;
  ageDays: number;
}

interface Column {
  stage: string;
  label: string;
}

interface Props {
  columns: Column[];
  cards: BoardCard[];
}

const STALE_DAYS = 7;

/** Drag-and-drop pipeline board (native HTML5 DnD). Optimistically moves the
 * card, then persists via the server action; reverts on error. */
export default function PipelineBoard({ columns, cards: initial }: Props) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const drop = (stage: string) => {
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const card = cards.find((c) => c.customerId === id);
    if (!card || card.stage === stage) return;

    const prev = cards;
    setCards((cs) => cs.map((c) => (c.customerId === id ? { ...c, stage, ageDays: 0 } : c)));
    setError(null);
    startTransition(async () => {
      const result = await moveCustomerStage(id, stage);
      if (result.error) {
        setCards(prev); // revert
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => {
          const colCards = cards.filter((c) => c.stage === col.stage);
          return (
            <div
              key={col.stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(col.stage)}
              className="flex w-64 shrink-0 flex-col rounded-xl bg-slate-100/70 p-2"
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-slate-600">{col.label}</span>
                <span className="text-[10px] text-slate-400">{colCards.length}</span>
              </div>
              <div className="space-y-2">
                {colCards.map((c) => (
                  <div
                    key={c.customerId}
                    draggable
                    onDragStart={() => setDragId(c.customerId)}
                    className="cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing"
                  >
                    <Link
                      href={`/dashboard/customers/${c.customerId}`}
                      className="text-sm font-medium text-slate-800 hover:text-blue-600"
                    >
                      {c.name}
                    </Link>
                    {c.subtitle && <p className="mt-0.5 truncate text-xs text-slate-400">{c.subtitle}</p>}
                    {c.ageDays >= STALE_DAYS && (
                      <p className="mt-1 text-[10px] font-medium text-red-500">{c.ageDays}d in stage</p>
                    )}
                  </div>
                ))}
                {colCards.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-[11px] text-slate-300">
                    Drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
