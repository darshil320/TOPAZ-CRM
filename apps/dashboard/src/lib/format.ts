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

/**
 * Whole days between two YYYY-MM-DD calendar dates (to - from). Uses Date.UTC on
 * the parsed y/m/d parts rather than `new Date(iso)` arithmetic — both inputs are
 * already plain calendar dates (not instants), so this avoids any DST/local-
 * timezone drift a bare millisecond subtraction could introduce.
 */
export function daysBetween(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

/** todayISO() shifted by `days` (may be negative), as YYYY-MM-DD. */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Human copy + tone for a lead's follow-up due date. Never implies automation —
 * this reflects a date a salesperson set, checked against today; the daily scan
 * (tasks/lead_followup_notify.py) that turns an overdue date into a notification
 * is a separate concern this function knows nothing about.
 */
export function daysUntilLabel(
  dueOn: string | null,
): { text: string; tone: "warn" | "plain" } | null {
  if (!dueOn) return null;
  const days = daysBetween(todayISO(), dueOn);
  if (days < 0) {
    const n = -days;
    return { text: `Overdue by ${n} day${n === 1 ? "" : "s"}`, tone: "warn" };
  }
  if (days === 0) return { text: "Due today", tone: "warn" };
  return { text: `Due in ${days} day${days === 1 ? "" : "s"}`, tone: "plain" };
}
