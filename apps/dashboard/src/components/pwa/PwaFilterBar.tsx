"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";

/**
 * Search + status chips for the three shop-floor PWAs.
 *
 * Built for the actual device: a phone held one-handed in a workshop, often in
 * gloves and sunlight. Hence the rules encoded here —
 *   · the bar STICKS under the app bar, because these lists are long and the
 *     filter is useless if you have to scroll back up to it;
 *   · chips carry their count, so "0 overdue" is answerable without tapping;
 *   · every target is ≥ 40px tall;
 *   · the accent follows the app (amber workshop / emerald delivery / sky
 *     transit) so the control never looks borrowed from another screen.
 *
 * State lives in the parent — these lists are already fully in memory and the
 * filtering is synchronous, so a URL round-trip would only add latency.
 */

export type PwaAccent = "amber" | "emerald" | "sky";

export interface FilterChip {
  id: string;
  label: string;
  count: number;
}

const ACCENT: Record<PwaAccent, { active: string; focus: string; ring: string }> = {
  amber: {
    active: "bg-amber-500 text-slate-950 border-amber-400",
    focus: "focus:border-amber-500",
    ring: "text-amber-400",
  },
  emerald: {
    active: "bg-emerald-500 text-slate-950 border-emerald-400",
    focus: "focus:border-emerald-500",
    ring: "text-emerald-400",
  },
  sky: {
    active: "bg-sky-500 text-slate-950 border-sky-400",
    focus: "focus:border-sky-500",
    ring: "text-sky-400",
  },
};

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  chips?: FilterChip[];
  activeChip?: string;
  onChipChange?: (id: string) => void;
  accent?: PwaAccent;
  /** e.g. "3 of 12" — rendered only while a filter is active. */
  resultLabel?: string | null;
  /** Extra controls (a site selector, a sort) rendered beside the chips. */
  children?: ReactNode;
}

export default function PwaFilterBar({
  query,
  onQueryChange,
  placeholder,
  chips = [],
  activeChip,
  onChipChange,
  accent = "amber",
  resultLabel,
  children,
}: Props) {
  const tone = ACCENT[accent];
  const isFiltered = query.trim() !== "" || (activeChip !== undefined && activeChip !== "all");

  return (
    <div className="sticky top-16 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-slate-950/95 backdrop-blur-md border-b border-slate-900 space-y-2.5">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          inputMode="search"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => onQueryChange(e.target.value)}
          className={`w-full h-11 pl-9 pr-10 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none ${tone.focus} transition-colors`}
        />
        {query !== "" && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {(chips.length > 0 || children) && (
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map((chip) => {
            const active = chip.id === activeChip;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onChipChange?.(chip.id)}
                aria-pressed={active}
                className={`shrink-0 h-9 px-3 rounded-lg border text-xs font-bold transition-all flex items-center gap-1.5 ${
                  active
                    ? tone.active
                    : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <span>{chip.label}</span>
                <span className={`font-mono ${active ? "opacity-70" : "text-slate-500"}`}>
                  {chip.count}
                </span>
              </button>
            );
          })}
          {children}
        </div>
      )}

      {isFiltered && resultLabel && (
        <p className={`text-[11px] font-semibold font-mono ${tone.ring}`}>{resultLabel}</p>
      )}
    </div>
  );
}
