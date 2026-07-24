"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { computeTotals, HOME_STATE } from "@/lib/gst";
import { formatINR } from "@/lib/format";
import { STATE_OPTIONS } from "./states";
import { createQuote, updateQuote } from "./actions";
import CustomerPicker from "./CustomerPicker";
import LineItemsEditor from "./LineItemsEditor";
import type { CustomerOption, LineDraft, ProductOption, QuotePayload } from "./types";

export interface QuoteBuilderInitial {
  customerId: string;
  discount: string;
  placeOfSupply: string;
  validUntil: string;
  terms: string;
  notes: string;
  lines: LineDraft[];
}

interface Props {
  mode: "create" | "edit";
  /** Present in edit mode; the quotation being updated. */
  quoteId?: string;
  customers: CustomerOption[];
  products: ProductOption[];
  initial: QuoteBuilderInitial;
}

/** A blank line with placeholder-friendly defaults (HSN/GST from the furniture
 * catalog fallback — 9403 / 18%, per PLAN.md; overridable per line). */
function emptyLine(key: string): LineDraft {
  return {
    key,
    product_id: null,
    description: "",
    hsn: "9403",
    gst_rate: "18",
    qty: "1",
    unit: "nos",
    unit_price: "",
    dimensions: "",
    material: "",
    fabric: "",
    polish: "",
    customization: "",
  };
}

function toItemPayload(line: LineDraft) {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  return {
    description: line.description.trim(),
    qty: line.qty || "0",
    unit_price: line.unit_price || "0",
    hsn: line.hsn.trim(),
    gst_rate: line.gst_rate || "0",
    product_id: line.product_id,
    unit: opt(line.unit),
    dimensions: opt(line.dimensions),
    material: opt(line.material),
    fabric: opt(line.fabric),
    polish: opt(line.polish),
    customization: opt(line.customization),
  };
}

export default function QuoteBuilder({ mode, quoteId, customers, products, initial }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState(initial.customerId);
  const [lines, setLines] = useState<LineDraft[]>(initial.lines);
  const [discount, setDiscount] = useState(initial.discount);
  const [placeOfSupply, setPlaceOfSupply] = useState(initial.placeOfSupply);
  const [validUntil, setValidUntil] = useState(initial.validUntil);
  const [terms, setTerms] = useState(initial.terms);
  const [notes, setNotes] = useState(initial.notes);

  // Monotonic counter for new-row keys — avoids Math.random()/Date.now() so the
  // client render matches SSR (no hydration mismatch).
  const nextKey = useRef(0);
  const makeKey = () => `new-${nextKey.current++}`;

  const totals = useMemo(
    () =>
      computeTotals(
        lines.map((l) => ({
          qty: Number(l.qty) || 0,
          unitPrice: Number(l.unit_price) || 0,
          gstRate: Number(l.gst_rate) || 0,
        })),
        Number(discount) || 0,
        placeOfSupply,
      ),
    [lines, discount, placeOfSupply],
  );
  const intra = placeOfSupply === HOME_STATE;

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const applyProduct = (key: string, product: ProductOption | null) =>
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? product
            ? {
                ...l,
                product_id: product.id,
                description: l.description || product.name,
                hsn: product.hsn,
                gst_rate: String(product.gst_rate),
                unit: product.unit ?? l.unit,
                unit_price: product.base_price != null ? String(product.base_price) : l.unit_price,
              }
            : { ...l, product_id: null }
          : l,
      ),
    );

  const removeLine = (key: string) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));

  const addLine = () => setLines((prev) => [...prev, emptyLine(makeKey())]);

  const submit = () => {
    setError(null);
    const payload: QuotePayload = {
      customer_id: customerId,
      discount: discount || "0",
      place_of_supply: placeOfSupply,
      valid_until: validUntil || null,
      terms: terms.trim() || null,
      notes: notes.trim() || null,
      items: lines.map(toItemPayload),
    };

    startTransition(async () => {
      const result =
        mode === "edit" && quoteId
          ? await updateQuote(quoteId, payload)
          : await createQuote(payload);
      if (result.error || !result.id) {
        setError(result.error ?? "Something went wrong");
        return;
      }
      router.push(`/dashboard/quotes/${result.id}`);
      router.refresh();
    });
  };

  const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const sectionLabel = "text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3";
  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className={sectionLabel}>Customer</p>
        <CustomerPicker
          customers={customers}
          value={customerId}
          onChange={setCustomerId}
          disabled={mode === "edit"}
        />
      </div>

      <div className={card}>
        <p className={sectionLabel}>Line Items</p>
        <LineItemsEditor
          lines={lines}
          products={products}
          onUpdate={updateLine}
          onApplyProduct={applyProduct}
          onRemove={removeLine}
          onAdd={addLine}
        />
      </div>

      <div className={card}>
        <p className={sectionLabel}>Quote Details</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Discount (₹)</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Place of supply</label>
            <select
              value={placeOfSupply}
              onChange={(e) => setPlaceOfSupply(e.target.value)}
              className={inputCls}
            >
              {STATE_OPTIONS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Valid until</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs text-slate-500">Terms &amp; conditions</label>
          <textarea
            value={terms}
            rows={3}
            placeholder="Payment terms, delivery timeline, warranty…"
            onChange={(e) => setTerms(e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs text-slate-500">Internal notes (not shown to customer)</label>
          <textarea
            value={notes}
            rows={2}
            onChange={(e) => setNotes(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      {/* Live totals — client mirror of gst.py; the server recomputes on save. */}
      <div className={card}>
        <p className={sectionLabel}>Totals (preview)</p>
        <dl className="space-y-1.5 text-sm">
          <Row label="Subtotal" value={formatINR(totals.subtotal)} />
          {totals.discountAmount > 0 && (
            <Row label="Discount" value={`− ${formatINR(totals.discountAmount)}`} />
          )}
          <Row label="Taxable value" value={formatINR(totals.taxableValue)} />
          {intra ? (
            <>
              <Row label="CGST" value={formatINR(totals.cgst)} muted />
              <Row label="SGST" value={formatINR(totals.sgst)} muted />
            </>
          ) : (
            <Row label="IGST" value={formatINR(totals.igst)} muted />
          )}
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <dt className="text-sm font-semibold text-slate-900">Grand total</dt>
            <dd className="text-base font-bold text-slate-900">{formatINR(totals.grandTotal)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-slate-400">
          Final tax is recalculated on the server when you save.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving…" : mode === "edit" ? "Save changes" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={isPending}
          className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? "text-slate-400" : "text-slate-500"}>{label}</dt>
      <dd className={muted ? "text-slate-500" : "text-slate-700"}>{value}</dd>
    </div>
  );
}
