/** Small shared formatters for money and dates (Indian locale). */

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a rupee amount. Accepts number or numeric string; falls back to ₹0.00. */
export function formatINR(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  return INR.format(Number.isFinite(n as number) ? (n as number) : 0);
}

/**
 * Showroom timezone. Every "is this overdue?" and "is this date in the past?"
 * decision is made in the showroom's local day, not the server's UTC day — the
 * FastAPI side compares against `date.today()` in the same locale.
 */
const SHOWROOM_TZ = process.env.NEXT_PUBLIC_SHOWROOM_TZ ?? "Asia/Kolkata";

// 'en-CA' is the shortest reliable route to YYYY-MM-DD out of Intl.
const ISO_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHOWROOM_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today in the showroom's timezone as YYYY-MM-DD. */
export function todayISO(): string {
  return ISO_DAY.format(new Date());
}

/**
 * True when a YYYY-MM-DD date is strictly before today in the showroom's
 * timezone. String comparison is safe for zero-padded ISO days.
 */
export function isPastDay(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.slice(0, 10) < todayISO();
}

/** Format an ISO date/timestamp as "24 Jul 2026". Returns "—" when absent. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
