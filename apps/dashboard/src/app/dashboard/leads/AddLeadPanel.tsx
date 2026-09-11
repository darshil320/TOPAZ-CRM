"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import LeadForm from "./LeadForm";

type Props = { salespersons: { id: string; label: string }[] };

/**
 * The capture form, collapsed by default.
 *
 * The table is what staff read all day; a permanently-open form pushed it below the
 * fold. The form opens in place and closes itself on a successful save, so capturing
 * several leads in a row is still two clicks each and the new row is visible immediately.
 */
export default function AddLeadPanel({ salespersons }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant={open ? "secondary" : "primary"}
          aria-expanded={open}
          aria-controls="add-lead-form"
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? "Close" : "New Lead"}
        </Button>
        {!open && (
          <span className="text-caption text-t3">
            Capture a walk-in, call, or enquiry from social.
          </span>
        )}
      </div>

      {open && (
        <div id="add-lead-form">
          <LeadForm salespersons={salespersons} onSaved={() => setOpen(false)} />
        </div>
      )}
    </section>
  );
}
