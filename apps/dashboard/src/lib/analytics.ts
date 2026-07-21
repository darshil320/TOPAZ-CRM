/**
 * Pure aggregation helpers for the owner analytics view (M6B).
 *
 * No structured order value exists yet (that's Phase 2 order management), so
 * "sales" is measured as deals moved to `won`, dated by `pipeline_stages.updated_at`
 * (the terminal-stage timestamp is a faithful proxy for the win date). Monetary
 * value is a best-effort parse of the free-text `budget` logged in meeting notes.
 */

export const PIPELINE_STAGES = ["new", "talking", "follow_up", "won", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type StageRow = { stage: string | null; updated_at: string | null };

export type StageCounts = Record<PipelineStage, number>;

export function emptyStageCounts(): StageCounts {
  return { new: 0, talking: 0, follow_up: 0, won: 0, lost: 0 };
}

export function countByStage(rows: StageRow[]): StageCounts {
  const counts = emptyStageCounts();
  for (const row of rows) {
    const stage = row.stage as PipelineStage | null;
    if (stage && stage in counts) counts[stage] += 1;
  }
  return counts;
}

/** Won / (won + lost). 0 when no closed deals yet. */
export function conversionRate(counts: StageCounts): number {
  const closed = counts.won + counts.lost;
  return closed === 0 ? 0 : counts.won / closed;
}

export type DailyPoint = { date: string; label: string; count: number };

/**
 * Won-deal count per day for the last `days` days (oldest → newest), including
 * empty days. `today` is injected so the function stays pure/testable.
 */
export function wonByDay(rows: StageRow[], days: number, today: Date): DailyPoint[] {
  const buckets = new Map<string, number>();
  const points: DailyPoint[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = isoDate(d);
    buckets.set(key, 0);
    points.push({
      date: key,
      label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      count: 0,
    });
  }

  for (const row of rows) {
    if (row.stage !== "won" || !row.updated_at) continue;
    const key = isoDate(new Date(row.updated_at));
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return points.map((p) => ({ ...p, count: buckets.get(p.date) ?? 0 }));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Best-effort parse of a free-text budget into rupees. Understands lakh/L,
 * crore/cr, k, plain numbers, and Indian comma grouping. Returns null when
 * nothing numeric is present.
 */
export function parseBudgetToINR(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.toLowerCase().replace(/[,₹\s]/g, "");
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value)) return null;

  if (/(cr|crore)/.test(cleaned)) return Math.round(value * 1e7);
  if (/(l|lakh|lac)/.test(cleaned)) return Math.round(value * 1e5);
  if (/k\b/.test(cleaned) || cleaned.includes("k")) return Math.round(value * 1e3);
  return Math.round(value);
}

/** Compact INR formatting: 150000 → "₹1.5L", 12000000 → "₹1.2Cr". */
export function formatINR(amount: number): string {
  if (amount >= 1e7) return `₹${(amount / 1e7).toFixed(amount % 1e7 === 0 ? 0 : 1)}Cr`;
  if (amount >= 1e5) return `₹${(amount / 1e5).toFixed(amount % 1e5 === 0 ? 0 : 1)}L`;
  if (amount >= 1e3) return `₹${(amount / 1e3).toFixed(0)}K`;
  return `₹${amount}`;
}
