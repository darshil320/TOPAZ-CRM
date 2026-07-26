"use client";

import { useState } from "react";
import { computeLineTotal } from "@/lib/gst";
import { formatINR } from "@/lib/format";
import type { LineDraft, ProductOption } from "./types";

import Button from "@/components/ui/Button";

interface Props {
  lines: LineDraft[];
  products: ProductOption[];
  onUpdate: (key: string, patch: Partial<LineDraft>) => void;
  onApplyProduct: (key: string, product: ProductOption | null) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}

const FIELD =
  "w-full rounded-md border border-ln bg-sf px-3 py-1.5 text-ui text-t1 placeholder-t3 focus:border-acc focus:outline-none transition-all";
const LABEL = "block text-caption font-semibold text-t2 mb-1";

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
          <div key={line.key} className="rounded-card border border-ln bg-sf2 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-caption font-semibold text-t1">Item {index + 1}</span>
              <button
                type="button"
                onClick={() => onRemove(line.key)}
                disabled={lines.length === 1}
                className="text-caption font-semibold text-warn hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                Remove
              </button>
            </div>

            {products.length > 0 && (
              <div>
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

            <div>
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
                  className={`${FIELD} font-mono`}
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
                  className={`${FIELD} font-mono`}
                />
              </div>
              <div className="col-span-1">
                <label className={LABEL}>HSN</label>
                <input
                  type="text"
                  value={line.hsn}
                  placeholder="9403"
                  onChange={(e) => onUpdate(line.key, { hsn: e.target.value })}
                  className={`${FIELD} font-mono`}
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
                  className={`${FIELD} font-mono`}
                />
              </div>
              <div className="col-span-1 flex flex-col justify-end">
                <label className={LABEL}>Line total</label>
                <div className="rounded-md border border-ln bg-sf px-2.5 py-1.5 text-ui font-mono font-bold text-t1">
                  {formatINR(lineTotal)}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setExpanded((prev) => ({ ...prev, [line.key]: !prev[line.key] }))}
              className="text-caption font-semibold text-t1 hover:text-acc transition-colors"
            >
              {isOpen ? "Hide" : "Add"} furniture details
            </button>

            {isOpen && (
              <div className="pt-2 border-t border-ln grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    ["dimensions", "Dimensions", "e.g. 84\" x 36\" x 32\""],
                    ["material", "Material", "e.g. Teak wood frame"],
                    ["fabric", "Fabric / Leather", "e.g. Velvet Royal Blue"],
                    ["polish", "Polish / Finish", "e.g. Walnut Matte"],
                    ["customization", "Customization", "e.g. Extra soft foam cushion"],
                  ] as const
                ).map(([key, labelText, placeholder]) => (
                  <div key={key}>
                    <label className={LABEL}>{labelText}</label>
                    <input
                      type="text"
                      value={line[key] ?? ""}
                      placeholder={placeholder}
                      onChange={(e) => onUpdate(line.key, { [key]: e.target.value })}
                      className={FIELD}
                    />
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <label className={LABEL}>Special / Custom Instructions (Job Card)</label>
                  <textarea
                    rows={2}
                    value={line.spec_notes ?? ""}
                    placeholder={"e.g. Marble Detail: Off White Base Brown Figure\nMolding: New Molding"}
                    onChange={(e) => onUpdate(line.key, { spec_notes: e.target.value })}
                    className={FIELD}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      <Button type="button" variant="secondary" onClick={onAdd} className="w-full justify-center">
        + Add Line Item
      </Button>
    </div>
  );
}
