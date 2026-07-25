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

// Colour palette per column index (cycles if more columns than colours)
const COL_COLOURS = [
  { header: "bg-slate-100 border-slate-300", dot: "bg-slate-400", badge: "bg-slate-200 text-slate-600" },
  { header: "bg-blue-50 border-blue-200", dot: "bg-blue-400", badge: "bg-blue-100 text-blue-700" },
  { header: "bg-violet-50 border-violet-200", dot: "bg-violet-400", badge: "bg-violet-100 text-violet-700" },
  { header: "bg-indigo-50 border-indigo-200", dot: "bg-indigo-400", badge: "bg-indigo-100 text-indigo-700" },
  { header: "bg-cyan-50 border-cyan-200", dot: "bg-cyan-400", badge: "bg-cyan-100 text-cyan-700" },
  { header: "bg-amber-50 border-amber-200", dot: "bg-amber-400", badge: "bg-amber-100 text-amber-700" },
  { header: "bg-orange-50 border-orange-200", dot: "bg-orange-400", badge: "bg-orange-100 text-orange-700" },
  { header: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-400", badge: "bg-emerald-100 text-emerald-700" },
  { header: "bg-rose-50 border-rose-200", dot: "bg-rose-400", badge: "bg-rose-100 text-rose-700" },
];

function colColour(index: number) {
  return COL_COLOURS[index % COL_COLOURS.length];
}

// ─── Desktop Kanban column ───────────────────────────────────────────────────
function KanbanColumn({
  col,
  colCards,
  colIndex,
  dragId,
  onDragStart,
  onDrop,
}: {
  col: Column;
  colCards: BoardCard[];
  colIndex: number;
  dragId: string | null;
  onDragStart: (id: string) => void;
  onDrop: (stage: string) => void;
}) {
  const c = colColour(colIndex);
  const [isOver, setIsOver] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={() => { setIsOver(false); onDrop(col.stage); }}
      className={`flex w-56 xl:w-64 shrink-0 flex-col rounded-2xl border ${c.header} transition-shadow ${
        isOver ? "shadow-lg ring-2 ring-blue-400/50" : ""
      }`}
    >
      {/* Column header */}
      <div className={`px-3 pt-3 pb-2 rounded-t-2xl border-b ${c.header}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
            <span className="text-xs font-bold text-slate-700 truncate">{col.label}</span>
          </div>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${c.badge}`}>
            {colCards.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 p-2 overflow-y-auto max-h-[calc(100vh-220px)]">
        {colCards.map((card) => (
          <div
            key={card.customerId}
            draggable
            onDragStart={() => onDragStart(card.customerId)}
            className={`group cursor-grab rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:shadow-md hover:-translate-y-px active:cursor-grabbing active:opacity-60 ${
              dragId === card.customerId ? "opacity-50 scale-95" : ""
            }`}
          >
            <Link
              href={`/dashboard/customers/${card.customerId}`}
              className="text-sm font-semibold text-slate-800 hover:text-blue-600 line-clamp-1"
            >
              {card.name}
            </Link>
            {card.subtitle && (
              <p className="mt-0.5 text-xs text-slate-400 truncate">{card.subtitle}</p>
            )}
            {card.ageDays >= STALE_DAYS && (
              <div className="mt-2 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
                <p className="text-[10px] font-semibold text-red-500">{card.ageDays}d in stage</p>
              </div>
            )}
          </div>
        ))}

        {colCards.length === 0 && (
          <div
            className={`rounded-xl border-2 border-dashed py-6 text-center text-[11px] text-slate-300 transition-colors ${
              isOver ? "border-blue-300 bg-blue-50/50 text-blue-400" : "border-slate-200"
            }`}
          >
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mobile accordion row ────────────────────────────────────────────────────
function MobileColumn({
  col,
  colCards,
  colIndex,
}: {
  col: Column;
  colCards: BoardCard[];
  colIndex: number;
}) {
  const [open, setOpen] = useState(colIndex === 0);
  const c = colColour(colIndex);

  return (
    <div className={`rounded-2xl border ${c.header} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-4 py-3 ${c.header}`}
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${c.dot}`} />
          <span className="text-sm font-bold text-slate-700">{col.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c.badge}`}>
            {colCards.length}
          </span>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 bg-white/60">
          {colCards.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-400">No customers in this stage</p>
          )}
          {colCards.map((card) => (
            <Link
              key={card.customerId}
              href={`/dashboard/customers/${card.customerId}`}
              className="flex items-start justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{card.name}</p>
                {card.subtitle && (
                  <p className="mt-0.5 text-xs text-slate-400 truncate">{card.subtitle}</p>
                )}
              </div>
              {card.ageDays >= STALE_DAYS && (
                <span className="ml-2 shrink-0 text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                  {card.ageDays}d
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main board ──────────────────────────────────────────────────────────────
/** Desktop: horizontal Kanban with drag-and-drop.
 *  Mobile: collapsible accordion list (touch-friendly). */
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
        setCards(prev);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      {error && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* ── Desktop Kanban (hidden on mobile) ── */}
      <div className="hidden sm:flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
        {columns.map((col, i) => (
          <KanbanColumn
            key={col.stage}
            col={col}
            colIndex={i}
            colCards={cards.filter((c) => c.stage === col.stage)}
            dragId={dragId}
            onDragStart={setDragId}
            onDrop={drop}
          />
        ))}
      </div>

      {/* ── Mobile accordion (hidden on desktop) ── */}
      <div className="sm:hidden space-y-2">
        {columns.map((col, i) => (
          <MobileColumn
            key={col.stage}
            col={col}
            colIndex={i}
            colCards={cards.filter((c) => c.stage === col.stage)}
          />
        ))}
      </div>
    </div>
  );
}
