import type { PillTone } from "@/components/ui/Pill";
import { formatDate } from "@/lib/format";

export const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = [
  "walk_in",
  "phone",
  "referral",
  "instagram",
  "facebook",
  "google",
  "whatsapp",
  "other",
] as const;

const SOURCE_LABELS: Record<string, string> = {
  walk_in: "Walk-in",
  phone: "Phone",
  referral: "Referral",
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  whatsapp: "WhatsApp",
  other: "Other",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function statusTone(status: string): PillTone {
  if (status === "converted") return "pos";
  if (status === "lost") return "warn";
  return "neutral";
}

// Mirrors services/lead_status.py ALLOWED_TRANSITIONS. Duplicated here only to keep
// the UI from offering a move the API will reject with a 409 — the API remains the
// authority, and a drift shows up as a rejected action, never as an illegal write.
const TRANSITIONS: Record<string, readonly string[]> = {
  new: ["contacted", "qualified", "lost"],
  contacted: ["qualified", "lost"],
  qualified: ["converted", "lost"],
  converted: [],
  lost: [],
};

export function nextStatuses(current: string): readonly string[] {
  return TRANSITIONS[current] ?? [];
}

/**
 * Human copy for the follow-up counter. Never implies automation — this is a
 * manual tally a salesperson updates by tapping "Log follow-up"
 * (LeadStatusActions), not a scheduled reminder. Mirrors
 * services/lead_status.py's DEFAULT_FOLLOW_UPS=3 only in that both read the SAME
 * persisted follow_ups_remaining column; this function does no defaulting itself.
 */
export function followUpLabel(remaining: number, lastContactedAt: string | null): string {
  const contactPart = lastContactedAt ? ` · last contacted ${formatDate(lastContactedAt)}` : "";
  if (remaining <= 0) return `No follow-ups remaining — decide next step${contactPart}`;
  if (remaining === 1) return `1 follow-up remaining${contactPart}`;
  return `${remaining} follow-ups remaining${contactPart}`;
}
