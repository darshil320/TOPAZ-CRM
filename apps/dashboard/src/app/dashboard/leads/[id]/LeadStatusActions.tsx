"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { nextStatuses, statusLabel } from "../status";
import { convertLead, logFollowUp, setLeadStatus } from "../actions";

type Props = {
  leadId: string;
  status: string;
  convertedCustomerId: string | null;
  followUpsRemaining: number;
};

/**
 * Progress or convert a lead. Deliberately NOT creator-gated — the API is not either
 * (see apps/api/src/api/leads.py::change_status): whoever picks up the phone moves the
 * lead, which is rarely whoever took the original enquiry.
 */
export default function LeadStatusActions({
  leadId, status, convertedCustomerId, followUpsRemaining,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const targets = nextStatuses(status);
  const isClosed = status === "converted" || status === "lost";

  function logFollowUpClick() {
    setError(null);
    start(async () => {
      const res = await logFollowUp(leadId);
      if (res.error) setError(res.error);
    });
  }

  function move(to: string) {
    setError(null);

    // Conversion creates a customer and a consent row, so it has its own route.
    if (to === "converted") {
      start(async () => {
        const res = await convertLead(leadId);
        if (res.error) {
          setError(res.error);
          return;
        }
        if (res.customerId) router.push(`/dashboard/customers/${res.customerId}`);
      });
      return;
    }

    let reason: string | undefined;
    if (to === "lost") {
      // window.prompt, as on the old row: the API rejects a blank reason (422) and a
      // one-field modal needs a Dialog primitive this design system does not have.
      const answer = window.prompt("Why was this lead lost?");
      if (answer === null) return;
      if (!answer.trim()) {
        setError("A reason is required to mark a lead lost.");
        return;
      }
      reason = answer.trim();
    }

    start(async () => {
      const res = await setLeadStatus(leadId, to, reason);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-start sm:items-end gap-1.5">
      {targets.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {targets.map((to) => (
            <Button
              key={to}
              type="button"
              variant={to === "converted" ? "primary" : "secondary"}
              disabled={pending}
              onClick={() => move(to)}
            >
              {to === "converted" ? "Convert to customer" : `Mark ${statusLabel(to)}`}
            </Button>
          ))}
        </div>
      ) : (
        <span className="text-caption text-t3">
          {convertedCustomerId ? "Converted — nothing left to move." : "Closed."}
        </span>
      )}
      {/* Not pre-gated on followUpsRemaining > 0: clicking at 0 surfaces the API's
          409 inline below, same pattern as letting the lost-reason prompt rely on
          the API's own 422 rather than duplicating validation client-side. */}
      {!isClosed && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={logFollowUpClick}
          title={`${followUpsRemaining} follow-up(s) remaining`}
        >
          Log follow-up
        </Button>
      )}
      {error && <p className="text-caption text-neg">{error}</p>}
    </div>
  );
}
