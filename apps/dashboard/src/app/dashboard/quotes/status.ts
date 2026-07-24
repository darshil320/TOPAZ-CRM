/** Status → chip presentation, shared by the list and detail views. Mirrors the
 * `status` CHECK constraint on the quotations table (migration 0014). */

export interface StatusChip {
  label: string;
  color: string;
}

const CHIPS: Record<string, StatusChip> = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-600 border-slate-200" },
  sent: { label: "Sent", color: "bg-blue-100 text-blue-700 border-blue-200" },
  viewed: { label: "Viewed", color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  approved: { label: "Approved", color: "bg-green-100 text-green-700 border-green-200" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700 border-red-200" },
  expired: { label: "Expired", color: "bg-amber-100 text-amber-700 border-amber-200" },
};

const FALLBACK: StatusChip = { label: "Unknown", color: "bg-slate-100 text-slate-600 border-slate-200" };

export function statusChip(status: string | null | undefined): StatusChip {
  if (!status) return FALLBACK;
  return CHIPS[status] ?? { label: status, color: FALLBACK.color };
}
