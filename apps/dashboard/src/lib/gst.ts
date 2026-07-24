/**
 * Client-side mirror of `apps/api/src/services/gst.py` — DISPLAY ONLY.
 *
 * The server ALWAYS recomputes and persists the authoritative totals
 * (PLAN.md decision 1: never trust client money). This mirror exists so the
 * QuoteBuilder can show live totals as a salesperson types. It deliberately
 * follows the exact same rounding rules as `gst.py` so the preview matches
 * what the server will store for ordinary inputs; on save the server value
 * wins.
 *
 * Rules replicated from gst.py:
 *  - per-line pre-tax total = round2(qty * unit_price)
 *  - subtotal = round2(sum of line totals)
 *  - a document discount (absolute) is clamped to the subtotal, then pro-rated
 *    across lines by their pre-tax share at full precision
 *  - CGST/SGST/IGST accumulated at full precision, each rounded half-up to 2dp
 *    at the document level
 *  - intra-state (place_of_supply === home_state) → CGST + SGST (each rate/2);
 *    inter-state → IGST (full rate)
 */

/** Home state for the GST intra/inter split — mirrors the API's HOME_STATE. */
export const HOME_STATE = process.env.NEXT_PUBLIC_HOME_STATE ?? "GJ";

export interface GstLineInput {
  qty: number;
  unitPrice: number;
  /** Percentage, e.g. 18 for 18%. */
  gstRate: number;
}

export interface GstTotals {
  subtotal: number;
  discountAmount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
}

/**
 * Round half-up to 2 decimals, mirroring Decimal(...).quantize(0.01,
 * ROUND_HALF_UP). All money here is non-negative; the epsilon nudge absorbs
 * binary-float representation error (e.g. 1.005 * 100 = 100.4999999).
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value * 100;
  const rounded = Math.round(scaled + (scaled >= 0 ? 1e-6 : -1e-6));
  return rounded / 100;
}

/** Pre-tax line total = round2(qty * unit_price). */
export function computeLineTotal(qty: number, unitPrice: number): number {
  return round2((qty || 0) * (unitPrice || 0));
}

export function computeTotals(
  lines: GstLineInput[],
  discount: number,
  placeOfSupply: string,
  homeState: string = HOME_STATE,
): GstTotals {
  // gst.py rejects a negative discount; the builder never sends one, but for a
  // resilient live preview we treat anything < 0 as 0.
  const safeDiscount = Number.isFinite(discount) && discount > 0 ? discount : 0;

  const lineTotals = lines.map((l) => computeLineTotal(l.qty, l.unitPrice));
  const subtotal = round2(lineTotals.reduce((sum, lt) => sum + lt, 0));

  const clampedDiscount = Math.min(safeDiscount, subtotal);
  const taxableValue = round2(subtotal - clampedDiscount);

  const intra = placeOfSupply === homeState;
  let cgstAcc = 0;
  let sgstAcc = 0;
  let igstAcc = 0;

  lines.forEach((line, i) => {
    const lt = lineTotals[i];
    const share = subtotal ? lt / subtotal : 0;
    const taxableLine = lt - clampedDiscount * share;
    const rate = (line.gstRate || 0) / 100;
    if (intra) {
      const half = rate / 2;
      cgstAcc += taxableLine * half;
      sgstAcc += taxableLine * half;
    } else {
      igstAcc += taxableLine * rate;
    }
  });

  const cgst = round2(cgstAcc);
  const sgst = round2(sgstAcc);
  const igst = round2(igstAcc);
  const grandTotal = round2(taxableValue + cgst + sgst + igst);

  return {
    subtotal,
    discountAmount: round2(clampedDiscount),
    taxableValue,
    cgst,
    sgst,
    igst,
    grandTotal,
  };
}
