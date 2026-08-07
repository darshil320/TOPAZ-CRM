/** Order status chips + legal next-transitions (mirrors services/order_status.py
 * on the backend; the API re-validates and is the source of truth). */

export interface StatusChip {
  label: string;
  color: string;
}

const CHIPS: Record<string, StatusChip> = {
  confirmed: { label: "Confirmed", color: "bg-blue-100 text-blue-700 border-blue-200" },
  in_production: { label: "In Production", color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  ready: { label: "Ready", color: "bg-cyan-100 text-cyan-700 border-cyan-200" },
  delivered: { label: "Delivered", color: "bg-teal-100 text-teal-700 border-teal-200" },
  installed: { label: "Installed", color: "bg-green-100 text-green-700 border-green-200" },
  closed: { label: "Closed", color: "bg-slate-200 text-slate-600 border-slate-300" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700 border-red-200" },
};

const FALLBACK: StatusChip = { label: "Unknown", color: "bg-slate-100 text-slate-600 border-slate-200" };

export function orderStatusChip(status: string | null | undefined): StatusChip {
  if (!status) return FALLBACK;
  return CHIPS[status] ?? { label: status, color: FALLBACK.color };
}

/** from-status -> ordered list of {to, label} the UI offers as action buttons.
 *
 * Cancel is offered wherever the goods are still ours — confirmed, in_production and
 * ready. It is deliberately absent from delivered/installed/closed: undoing a
 * delivered sale is a return, not a status change (services/order_status.py says the
 * same, and re-validates). */
export const NEXT_TRANSITIONS: Record<string, { to: string; label: string }[]> = {
  confirmed: [
    { to: "in_production", label: "Start production" },
    { to: "cancelled", label: "Cancel order" },
  ],
  in_production: [
    { to: "ready", label: "Mark ready" },
    { to: "cancelled", label: "Cancel order" },
  ],
  ready: [
    { to: "delivered", label: "Mark delivered" },
    { to: "cancelled", label: "Cancel order" },
  ],
  delivered: [{ to: "installed", label: "Mark installed" }],
  installed: [{ to: "closed", label: "Close order" }],
  closed: [],
  cancelled: [],
};

export const REASON_REQUIRED = new Set(["cancelled"]);
