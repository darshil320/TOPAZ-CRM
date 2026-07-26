"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { getReceiptUrl } from "../../payments/actions";

/**
 * Opens a payment's receipt PDF. The PDF is in a private bucket, so we ask the
 * API for a short-lived signed URL on click, then open it in a new tab.
 */
export default function ReceiptDownloadButton({ paymentId }: { paymentId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const { url, error } = await getReceiptUrl(paymentId);
      if (error || !url) {
        setError(error ?? "No receipt available");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button
        variant="secondary"
        onClick={handleClick}
        disabled={loading}
        title="Open receipt PDF"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {loading ? "Opening…" : "Receipt"}
      </Button>
      {error && <span className="text-[11px] text-warn">{error}</span>}
    </div>
  );
}
