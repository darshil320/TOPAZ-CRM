"use client";

import { useState } from "react";
import { computeLineTotal } from "@/lib/gst";
import { formatINR } from "@/lib/format";
import type { LineDraft, ProductOption } from "./types";

interface Props {
  lines: LineDraft[];
  products: ProductOption[];
  onUpdate: (key: string, patch: Partial<LineDraft>) => void;
  onApplyProduct: (key: string, product: ProductOption | null) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const LABEL = "block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1";

export default function LineItemsEditor({
  lines,
  products,
  onUpdate,
  onApplyProduct,
  onRemove,
  onAdd,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3">
      {lines.map((line, index) => {
        const lineTotal = computeLineTotal(Number(line.qty) || 0, Number(line.unit_price) || 0);
        const isOpen = Boolean(expanded[line.key]);
        return (
          <div key={line.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">Item {index + 1}</span>
              <button
                type="button"
                onClick={() => onRemove(line.key)}
                disabled={lines.length === 1}
                className="text-xs font-medium text-red-500 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            </div>

            {products.length > 0 && (
              <div className="mb-2">
                <label className={LABEL}>From catalog (optional)</label>
                <select
                  value={line.product_id ?? ""}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value) ?? null;
                    onApplyProduct(line.key, p);
                  }}
                  className={FIELD}
                >
                  <option value="">Free text (no catalog product)</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-2">
              <label className={LABEL}>Description</label>
              <input
                type="text"
                value={line.description}
                placeholder="e.g. 3-seater leather sofa"
                onChange={(e) => onUpdate(line.key, { description: e.target.value })}
                className={FIELD}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <div className="col-span-1">
                <label className={LABEL}>Qty</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={line.qty}
                  onChange={(e) => onUpdate(line.key, { qty: e.target.value })}
                  className={FIELD}
                />
              </div>
              <div className="col-span-1">
                <label className={LABEL}>Unit</label>
                <input
                  type="text"
                  value={line.unit}
                  placeholder="nos"
                  onChange={(e) => onUpdate(line.key, { unit: e.target.value })}
                  className={FIELD}
                />
              </div>
              <div className="col-span-1">
                <label className={LABEL}>Unit price ₹</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={line.unit_price}
                  onChange={(e) => onUpdate(line.key, { unit_price: e.target.value })}
                  className={FIELD}
                />
              </div>
              <div className="col-span-1">
                <label className={LABEL}>HSN</label>
                <input
                  type="text"
                  value={line.hsn}
                  placeholder="9403"
                  onChange={(e) => onUpdate(line.key, { hsn: e.target.value })}
                  className={FIELD}
                />
              </div>
              <div className="col-span-1">
                <label className={LABEL}>GST %</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="any"
                  value={line.gst_rate}
                  onChange={(e) => onUpdate(line.key, { gst_rate: e.target.value })}
                  className={FIELD}
                />
              </div>
              <div className="col-span-1 flex flex-col justify-end">
                <label className={LABEL}>Line total</label>
                <div className="rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-semibold text-slate-900">
                  {formatINR(lineTotal)}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setExpanded((prev) => ({ ...prev, [line.key]: !prev[line.key] }))}
              className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              {isOpen ? "Hide" : "Add"} furniture details
            </button>

            {isOpen && (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    ["dimensions", "Dimensions", "e.g. 84\" x 36\" x 32\""],
                    ["material", "Material", "e.g. Sheesham wood"],
                    ["fabric", "Fabric", "e.g. Suede, colour grey"],
                    ["polish", "Polish", "e.g. Walnut matte"],
                    ["customization", "Customization", "e.g. Extra storage drawer"],
                  ] as const
                ).map(([field, lbl, ph]) => (
                  <div key={field}>
                    <label className={LABEL}>{lbl}</label>
                    <input
                      type="text"
                      value={line[field]}
                      placeholder={ph}
                      onChange={(e) => onUpdate(line.key, { [field]: e.target.value })}
                      className={FIELD}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        className="w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600"
      >
        + Add another item
      </button>
    </div>
  );
}
