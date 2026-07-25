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

import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";

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

/** A blank line with placeholder-friendly defaults */
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
    hsn: line.hsn.trim() || "9403",
    gst_rate: line.gst_rate || "18",
    product_id: line.product_id,
    unit: opt(line.unit),
    dimensions: opt(line.dimensions),
    material: opt(line.material),
    fabric: opt(line.fabric),
    polish: opt(line.polish),
    customization: opt(line.customization),
  };
}

export default function QuoteBuilder({
  mode,
  quoteId,
  customers,
  products,
  initial,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [customerId, setCustomerId] = useState<string>(initial.customerId);
  const [discount, setDiscount] = useState<string>(initial.discount);
  const [placeOfSupply, setPlaceOfSupply] = useState<string>(
    initial.placeOfSupply || HOME_STATE,
  );
  const [validUntil, setValidUntil] = useState<string>(initial.validUntil);
  const [terms, setTerms] = useState<string>(initial.terms);
  const [notes, setNotes] = useState<string>(initial.notes);
  const [lines, setLines] = useState<LineDraft[]>(initial.lines);
  const [error, setError] = useState<string | null>(null);

  const nextKey = useRef(lines.length + 1);

  const addLine = () => {
    const k = `l_${nextKey.current++}`;
    setLines((prev) => [...prev, emptyLine(k)]);
  };

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  };

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  };

  const applyProduct = (key: string, product: ProductOption | null) => {
    if (!product) {
      updateLine(key, { product_id: null });
      return;
    }
    updateLine(key, {
      product_id: product.id,
      description: product.name,
      unit_price: String(product.base_price ?? 0),
      hsn: product.hsn ?? "9403",
      gst_rate: String(product.gst_rate ?? 18),
    });
  };

  const totals = useMemo(() => {
    const rawLines = lines.map((l) => ({
      qty: Number(l.qty) || 0,
      unitPrice: Number(l.unit_price) || 0,
      gstRate: Number(l.gst_rate) || 0,
    }));
    return computeTotals(rawLines, Number(discount) || 0, placeOfSupply);
  }, [lines, discount, placeOfSupply]);

  const intra = placeOfSupply === HOME_STATE;

  const submit = () => {
    setError(null);
    if (!customerId) {
      setError("Please select a customer.");
      return;
    }
    const cleanLines = lines
      .filter((l) => l.description.trim().length > 0)
      .map(toItemPayload);

    if (cleanLines.length === 0) {
      setError("Add at least one line item with a description.");
      return;
    }

    const payload: QuotePayload = {
      customer_id: customerId,
      discount: discount || "0",
      place_of_supply: placeOfSupply,
      valid_until: validUntil || null,
      terms: terms.trim() || null,
      notes: notes.trim() || null,
      items: cleanLines,
    };

    startTransition(async () => {
      const res =
        mode === "edit" && quoteId
          ? await updateQuote(quoteId, payload)
          : await createQuote(payload);

      if (res.error || !res.id) {
        setError(res.error ?? "Failed to save quotation");
        return;
      }
      router.push(`/dashboard/quotes/${res.id}`);
      router.refresh();
    });
  };

  const inputCls =
    "w-full rounded-md border border-ln bg-sf px-3 py-2 text-ui text-t1 placeholder-t3 focus:border-acc focus:outline-none transition-all";
  const labelCls = "mb-1 block text-caption font-semibold text-t2";

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <SectionHeader label="Customer" />
        <CustomerPicker
          customers={customers}
          value={customerId}
          onChange={setCustomerId}
          disabled={mode === "edit"}
        />
      </Card>

      <Card className="space-y-3">
        <SectionHeader label="Line Items" />
        <LineItemsEditor
          lines={lines}
          products={products}
          onUpdate={updateLine}
          onApplyProduct={applyProduct}
          onRemove={removeLine}
          onAdd={addLine}
        />
      </Card>

      <Card className="space-y-4">
        <SectionHeader label="Quote Details" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Discount (₹)</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className={`${inputCls} font-mono`}
            />
          </div>
          <div>
            <label className={labelCls}>Place of supply</label>
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
            <label className={labelCls}>Valid until</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Terms &amp; conditions</label>
          <textarea
            value={terms}
            rows={3}
            placeholder="Payment terms, delivery timeline, warranty…"
            onChange={(e) => setTerms(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Internal notes (not shown to customer)</label>
          <textarea
            value={notes}
            rows={2}
            onChange={(e) => setNotes(e.target.value)}
            className={inputCls}
          />
        </div>
      </Card>

      {/* Live totals preview */}
      <Card className="space-y-3">
        <SectionHeader label="Totals (preview)" />
        <dl className="space-y-1.5 text-ui">
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
          <div className="mt-2 flex items-center justify-between border-t border-ln pt-2">
            <dt className="text-ui font-semibold text-t1">Grand total</dt>
            <dd className="text-body font-bold font-mono text-t1">{formatINR(totals.grandTotal)}</dd>
          </div>
        </dl>
        <p className="text-caption text-t3">
          Final tax is recalculated on the server when you save.
        </p>
      </Card>

      {error && (
        <Card className="border-warn/50 bg-warn/10 text-warn text-caption font-semibold">
          {error}
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={submit}
          disabled={isPending}
        >
          {isPending ? "Saving…" : mode === "edit" ? "Save changes" : "Save draft"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? "text-t3" : "text-t2"}>{label}</dt>
      <dd className={muted ? "text-t3 font-mono tabular-nums" : "text-t1 font-mono tabular-nums font-semibold"}>{value}</dd>
    </div>
  );
}
