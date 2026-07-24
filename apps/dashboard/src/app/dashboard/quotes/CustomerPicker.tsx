"use client";

import { useMemo, useRef, useState } from "react";
import type { CustomerOption } from "./types";

interface Props {
  customers: CustomerOption[];
  value: string;
  onChange: (id: string) => void;
  /** Edit mode: the customer is fixed for the life of a quotation. */
  disabled?: boolean;
}

function label(c: CustomerOption): string {
  return c.name?.trim() || c.phone?.trim() || "Unknown customer";
}

/** Lightweight searchable customer selector. Filters the assigned/visible
 * customers the RLS-scoped read already returned — no extra fetching. */
export default function CustomerPicker({ customers, value, onChange, disabled = false }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = customers.find((c) => c.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? customers.filter((c) => label(c).toLowerCase().includes(q) || (c.phone ?? "").includes(q))
      : customers;
    return pool.slice(0, 20);
  }, [customers, query]);

  if (disabled) {
    return (
      <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {selected ? label(selected) : "—"}
      </div>
    );
  }

  const pick = (c: CustomerOption) => {
    onChange(c.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      {selected && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 hover:border-slate-400"
        >
          <span className="truncate">{label(selected)}</span>
          <span className="ml-2 text-xs text-blue-600">Change</span>
        </button>
      ) : (
        <input
          type="text"
          autoFocus={open}
          value={query}
          placeholder="Search customer by name or phone…"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            // Delay so an option click registers before the list unmounts.
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      )}

      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-slate-400">No matching customers</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  pick(c);
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="text-sm text-slate-900">{label(c)}</span>
                {c.phone && c.name && <span className="text-xs text-slate-400">{c.phone}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
