"use client";

/** Quantity per location with big −/+ steppers — thumb-friendly on a showroom floor. */
import { Minus, Plus } from "lucide-react";
import type { StockLocation } from "@/lib/products/types";

const MAX_QTY = 100_000;

function step(value: string, delta: number): string {
  const n = Number.parseInt(value || "0", 10);
  const safe = Number.isFinite(n) ? n : 0;
  return String(Math.min(MAX_QTY, Math.max(0, safe + delta)));
}

export default function StockInputs({
  locations,
  values,
  onChange,
  disabled,
}: {
  locations: StockLocation[];
  values: Record<string, string>;
  onChange: (locationId: string, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="divide-y divide-ln2 rounded-card border border-ln bg-sf">
      {locations.map((loc) => {
        const value = values[loc.id] ?? "0";
        return (
          <li key={loc.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <label htmlFor={`stock-${loc.id}`} className="text-ui text-t1">
              {loc.name}
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={disabled || value === "0"}
                onClick={() => onChange(loc.id, step(value, -1))}
                aria-label={`One less at ${loc.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-ln bg-sf2 text-t2 disabled:opacity-40"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                id={`stock-${loc.id}`}
                value={value}
                onChange={(e) => onChange(loc.id, e.target.value.replace(/\D/g, "").slice(0, 6))}
                onFocus={(e) => e.target.select()}
                inputMode="numeric"
                disabled={disabled}
                className="h-9 w-16 rounded-md border border-ln bg-sf2 text-center font-mono text-ui tabular-nums text-t1 focus:border-acc focus:outline-none"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(loc.id, step(value, 1))}
                aria-label={`One more at ${loc.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-ln bg-sf2 text-t2 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
