/**
 * Pure display helpers for deadlines and legs — shared by the workshop PWA, the
 * mediator app and the production board so all three read the same way.
 *
 * IST, always. The showroom is in Surat; a deadline rendered in the browser's locale
 * would show a different day to a manager travelling, and "due today" is the one thing
 * on the card that must never be ambiguous.
 *
 * Deliberately framework-free (no React, no server imports) so it is trivially
 * testable and usable from both client and server components.
 */

const IST_TZ = "Asia/Kolkata";

export type DueTone = "none" | "ok" | "soon" | "overdue";

export interface DueDisplay {
  /** "Thu 30 Jul, 6:00 PM" — matches the WhatsApp copy byte for byte. */
  label: string;
  /** "in 2 days" / "in 5 hours" / "3 days late" / "due now". */
  relative: string;
  tone: DueTone;
  overdue: boolean;
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ,
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const DATE_ONLY_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Hours of runway below which a deadline turns amber. One working day. */
const SOON_HOURS = 24;

export function formatDueAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  // en-IN yields "Thu, 30 Jul, 6:00 pm"; normalise the separators and the meridiem so
  // the string matches services/transit_messages.format_ist().
  return DATE_TIME_FORMAT.format(at).replace(/,\s*/g, " ").replace(/\s(am|pm)/i, (m) => m.toUpperCase());
}

export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : DATE_ONLY_FORMAT.format(at);
}

export function relativeToNow(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const ms = at.getTime() - now.getTime();
  const late = ms < 0;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor(abs / 60_000);

  if (days >= 1) return late ? `${days} day${days > 1 ? "s" : ""} late` : `in ${days} day${days > 1 ? "s" : ""}`;
  if (hours >= 1) return late ? `${hours} hour${hours > 1 ? "s" : ""} late` : `in ${hours} hour${hours > 1 ? "s" : ""}`;
  if (minutes >= 1) return late ? `${minutes} min late` : `in ${minutes} min`;
  return "due now";
}

export function describeDue(iso: string | null | undefined, now: Date = new Date()): DueDisplay {
  if (!iso) {
    // A leg planned without days genuinely has no deadline. It must read as absent, not
    // as "on time" — the watchdog does not count days against it either.
    return { label: "—", relative: "no deadline set", tone: "none", overdue: false };
  }
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return { label: "—", relative: "", tone: "none", overdue: false };
  }
  const ms = at.getTime() - now.getTime();
  const overdue = ms < 0;
  const tone: DueTone = overdue ? "overdue" : ms <= SOON_HOURS * 3_600_000 ? "soon" : "ok";
  return { label: formatDueAt(iso), relative: relativeToNow(iso, now), tone, overdue };
}

/** "Leg 2 / 3" — omitted entirely when the item has no route (legacy allocation). */
export function legLabel(seq: number | null, total: number | null): string | null {
  if (!seq || !total || total < 1) return null;
  return `Leg ${seq} / ${total}`;
}

/**
 * Stage-span label using the client-confirmed Gujarati where available:
 * "પોલિશિંગ → ડિસ્પેચ". Falls back to English, then to the raw code.
 */
export function spanLabel(
  from: string | null,
  to: string | null,
  stages: { code: string; label_en: string; label_gu: string | null }[],
  lang: "gu" | "en" = "gu",
): string | null {
  if (!from || !to) return null;
  const pick = (code: string) => {
    const stage = stages.find((s) => s.code === code);
    if (!stage) return code;
    return (lang === "gu" ? stage.label_gu : stage.label_en) || stage.label_en || code;
  };
  return from === to ? pick(from) : `${pick(from)} → ${pick(to)}`;
}

/** Human label for a consignment status, Hindi first. */
export const TRANSFER_STATUS_LABEL: Record<string, string> = {
  ready: "उठाना बाकी / Awaiting pickup",
  picked_up: "उठा लिया / Collected",
  in_transit: "रास्ते में / In transit",
  delivered: "पहुँच गया / Delivered",
  received: "स्वीकार किया / Received",
  cancelled: "रद्द / Cancelled",
};
