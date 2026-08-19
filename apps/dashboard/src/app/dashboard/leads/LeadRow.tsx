"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Pill from "@/components/ui/Pill";
import Button from "@/components/ui/Button";
import { setLeadStatus, convertLead } from "./actions";
import { nextStatuses, sourceLabel, statusLabel, statusTone } from "./status";

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
  /** Resolved server-side from assigned_to; the row itself only stores the id. */
  assigned_name?: string | null;
};

export default function LeadRow({ lead }: { lead: LeadRowData }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const moves = nextStatuses(lead.status);

  function move(status: string) {
    setError(null);
    // 'lost' is the one transition the API requires a reason for; asking here keeps
    // the round trip from failing with a 422 the user cannot act on.
    let reason: string | undefined;
    if (status === "lost") {
      const answer = window.prompt("Why was this lead lost?");
      if (answer === null) return;
      if (!answer.trim()) {
        setError("A reason is required to mark a lead lost.");
        return;
      }
      reason = answer.trim();
    }
    startTransition(async () => {
      const result = await setLeadStatus(lead.id, status, reason);
      if (result.error) setError(result.error);
    });
  }

  function convert() {
    setError(null);
    startTransition(async () => {
      const result = await convertLead(lead.id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="border-b border-ln py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-body font-semibold text-t1 hover:text-acc transition-colors"
        >
          {lead.name || "(no name)"}
        </button>
        <span className="font-mono tabular-nums text-caption text-t2">{lead.phone}</span>
        <Pill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Pill>
        <span className="text-caption text-t3">{sourceLabel(lead.source)}</span>
        {lead.society && <span className="text-caption text-t3">· {lead.society}</span>}
        {lead.assigned_name && (
          <span className="text-caption text-t3">· {lead.assigned_name}</span>
        )}
        {/* Surfaced on the row, not hidden in the detail panel: whether this number is
            already a known customer changes how the salesperson opens the call. */}
        {lead.linked_customer_id && (
          <Link
            href={`/dashboard/customers/${lead.linked_customer_id}`}
            className="text-caption text-acc hover:underline"
          >
            existing customer
          </Link>
        )}
      </div>

      {open && (
        <div className="mt-2 grid grid-cols-1 gap-2 text-caption text-t2 sm:grid-cols-2">
          {lead.requirement && (
            <div className="sm:col-span-2">
              <span className="font-semibold text-t2">Requirement: </span>{lead.requirement}
            </div>
          )}
          {lead.address && (
            <div className="sm:col-span-2">
              <span className="font-semibold text-t2">Address: </span>{lead.address}
            </div>
          )}
          {lead.source_detail && (
            <div><span className="font-semibold text-t2">From: </span>{lead.source_detail}</div>
          )}
          {lead.comments && (
            <div className="sm:col-span-2">
              <span className="font-semibold text-t2">Comments: </span>{lead.comments}
            </div>
          )}
          {lead.lost_reason && (
            <div className="sm:col-span-2">
              <span className="font-semibold text-t2">Lost reason: </span>{lead.lost_reason}
            </div>
          )}
          {lead.converted_customer_id && (
            <div className="sm:col-span-2">
              <Link
                href={`/dashboard/customers/${lead.converted_customer_id}`}
                className="text-acc hover:underline"
              >
                View converted customer
              </Link>
            </div>
          )}

          <div className="sm:col-span-2 flex flex-wrap gap-2 pt-1">
            {moves
              .filter((s) => s !== "converted")
              .map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => move(s)}
                >
                  Mark {statusLabel(s)}
                </Button>
              ))}
            {moves.includes("converted") && (
              <Button type="button" disabled={pending} onClick={convert}>
                Convert to Customer
              </Button>
            )}
          </div>

          {error && <p role="alert" className="sm:col-span-2 text-caption text-neg">{error}</p>}
        </div>
      )}
    </div>
  );
}
