import Link from "next/link";
import Pill from "@/components/ui/Pill";
import { sourceLabel, statusLabel, statusTone } from "./status";

export type LeadRowData = {
  id: string;
  name: string | null;
  phone: string;
  society: string | null;
  address: string | null;
  requirement: string | null;
  comments: string | null;
  source: string;
  source_detail: string | null;
  status: string;
  lost_reason: string | null;
  linked_customer_id: string | null;
  converted_customer_id: string | null;
  created_at: string;
  assigned_to: string | null;
  created_by: string | null;
  follow_ups_remaining: number;
  last_contacted_at: string | null;
  /** Resolved server-side from assigned_to; the row itself only stores the id. */
  assigned_name?: string | null;
};

/**
 * One lead in the list, as a card that opens the lead's own page.
 *
 * A server component on purpose: the status/convert buttons and the collapsible body
 * moved to `[id]/`, so nothing here needs state, and a list of 100 leads ships no
 * client JS. The whole card is the link — a name-only target is a 14px hit area.
 */
export default function LeadRow({ lead }: { lead: LeadRowData }) {
  return (
    <Link
      href={`/dashboard/leads/${lead.id}`}
      className="block bg-sf rounded-card border border-ln p-4 shadow-sh hover:border-accL transition-all"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body font-semibold text-t1">{lead.name || "(no name)"}</span>
        <span className="font-mono tabular-nums text-caption text-t2">{lead.phone}</span>
        <Pill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Pill>
        <span className="text-caption text-t3">{sourceLabel(lead.source)}</span>
        {lead.society && <span className="text-caption text-t3">· {lead.society}</span>}
        {lead.assigned_name && (
          <span className="text-caption text-t3">· {lead.assigned_name}</span>
        )}
        {/* Surfaced on the row, not left to the detail page: whether this number is
            already a known customer changes how the salesperson opens the call.
            A span, not a Link — the card itself is an anchor, and a nested <a> is
            invalid HTML that `npm run build` does not catch. The customer is one
            click away on the detail page. */}
        {lead.linked_customer_id && (
          <span className="text-caption text-acc">existing customer</span>
        )}
        {/* Terser than status.ts's followUpLabel (no "last contacted" clause) — a
            scan-friendly chip, not the spacious detail-page hero line. Hidden once
            closed: the counter is not meaningful for a converted/lost lead. */}
        {lead.status !== "converted" && lead.status !== "lost" && (
          <span className="text-caption text-t3">
            · {lead.follow_ups_remaining} follow-up{lead.follow_ups_remaining === 1 ? "" : "s"} left
          </span>
        )}
      </div>

      {lead.requirement && (
        <p className="mt-1 text-caption text-t2 line-clamp-1">{lead.requirement}</p>
      )}
    </Link>
  );
}
