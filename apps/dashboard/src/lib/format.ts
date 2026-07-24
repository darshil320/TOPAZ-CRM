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

/** Format an ISO date/timestamp as "24 Jul 2026". Returns "—" when absent. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
