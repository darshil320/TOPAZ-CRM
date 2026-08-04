"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { haystack, matchesQuery } from "@/lib/textFilter";

/**
 * A `<select>` replacement for lists a human cannot scan — the ready-orders
 * list on a busy day is a hundred `ORD-2627-00xx` strings that look identical.
 * Typing an order number, a customer name or a phone number narrows it.
 *
 * Options are filtered in memory: the caller has already loaded them, so this
 * stays instant and works offline.
 */

export interface SelectOption {
  id: string;
  label: string;
  /** Second line — customer, status, whatever disambiguates two similar labels. */
  sublabel?: string;
  /** Extra text that should match but not be displayed (phone, GST, alias). */
  keywords?: string;
}

interface Props {
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  /** Cap on rendered rows; the search is how you reach the rest. */
  maxVisible?: number;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder = "Type to search…",
  emptyLabel = "No matches",
  disabled = false,
  maxVisible = 50,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const matched = options.filter((o) =>
      matchesQuery(haystack(o.label, o.sublabel, o.keywords), query),
    );
    return { rows: matched.slice(0, maxVisible), total: matched.length };
  }, [options, query, maxVisible]);

  // Close on an outside tap or Escape — a dropdown that only closes on select
  // traps a mis-tap, which on a modal over a table is a dead end.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (disabled) {
    return (
      <div className="w-full rounded-card border border-ln bg-sf2 p-2.5 text-caption font-semibold text-t3">
        {selected?.label ?? placeholder}
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 bg-sf2 border border-ln rounded-card p-2.5 text-left text-caption font-semibold text-t1 hover:border-accL focus:outline-none focus:border-acc transition-colors"
      >
        <span className={selected ? "truncate" : "truncate text-t3"}>
          {selected ? selected.label : placeholder}
          {selected?.sublabel && <span className="text-t3 font-normal"> — {selected.sublabel}</span>}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-t3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-card border border-ln bg-sf shadow-shp overflow-hidden">
          <div className="relative border-b border-ln">
            <Search className="w-4 h-4 text-t3 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              type="text"
              value={query}
              placeholder={searchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-sf pl-9 pr-3 py-2.5 text-caption text-t1 placeholder-t3 focus:outline-none"
            />
          </div>

          <div className="max-h-64 overflow-auto">
            {filtered.rows.length === 0 ? (
              <p className="px-3 py-3 text-caption text-t3">{emptyLabel}</p>
            ) : (
              filtered.rows.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-sf2 border-b border-ln2 last:border-0 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-caption font-semibold text-t1 font-mono truncate">
                      {o.label}
                    </span>
                    {o.sublabel && (
                      <span className="block text-[11px] text-t3 truncate">{o.sublabel}</span>
                    )}
                  </span>
                  {o.id === value && <Check className="w-4 h-4 text-acc shrink-0" />}
                </button>
              ))
            )}

            {filtered.total > filtered.rows.length && (
              <p className="px-3 py-2 text-[11px] text-t3 bg-sf2">
                Showing {filtered.rows.length} of {filtered.total} — keep typing to narrow.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
