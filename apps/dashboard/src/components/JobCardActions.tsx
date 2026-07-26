"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import {
  createJobCard,
  getJobCardUrl,
  sendJobCard,
  type JobCardSource,
} from "@/lib/jobCard/actions";

/**
 * Generate / open / send the job card — the money-free spec sheet.
 *
 * Used on both the quotation and the order page. The workshop send only appears
 * for orders: a quotation has no allocation, so there is nobody to send it to.
 *
 * Rendering is queued in Celery, so "Generate" reports queued rather than
 * pretending the PDF already exists — "Open" is what proves it landed.
 */
export default function JobCardActions({
  source,
  entityId,
  canSendToWorkshop = false,
}: {
  source: JobCardSource;
  entityId: string;
  canSendToWorkshop?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ error: string | null; url?: string }>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (result.error) {
        if (label === "open" && result.error.includes("No job card yet")) {
          setNotice("Generating job card in background — retry Open in a few seconds.");
          await createJobCard(source, entityId);
          return;
        }
        setError(result.error);
        return;
      }
      if (result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
        return;
      }
      setNotice(
        label === "generate"
          ? "Job card queued — use Open in a few seconds."
          : "Queued for sending.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => run("generate", () => createJobCard(source, entityId))}
          title="Render the specification sheet (no prices)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {busy === "generate" ? "Queuing…" : "Job card"}
        </Button>

        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => run("open", () => getJobCardUrl(source, entityId))}
          title="Open the latest job card PDF"
        >
          {busy === "open" ? "Opening…" : "Open"}
        </Button>

        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => run("customer", () => sendJobCard(source, entityId, "customer"))}
          title="WhatsApp the spec sheet to the customer (inside the 24h window)"
        >
          {busy === "customer" ? "Sending…" : "Send to customer"}
        </Button>

        {canSendToWorkshop && (
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => run("workshop", () => sendJobCard(source, entityId, "workshop"))}
            title="WhatsApp the job card to every workshop holding items of this order"
          >
            {busy === "workshop" ? "Sending…" : "Send to workshop"}
          </Button>
        )}
      </div>

      {error && <span className="text-[11px] text-warn">{error}</span>}
      {notice && <span className="text-[11px] text-t3">{notice}</span>}
      <span className="text-[11px] text-t3">
        Specifications only — no prices. Safe to share with a vendor workshop.
      </span>
    </div>
  );
}
