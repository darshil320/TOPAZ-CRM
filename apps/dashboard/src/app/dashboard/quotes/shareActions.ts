"use server";

/**
 * Quotation PDF for the Share button — a transport shim over
 * `/api/quotations/{id}/pdf`.
 *
 * Two calls, because rendering runs a headless browser in the worker and takes seconds:
 *   render → 202 (queued)
 *   fetch  → 200 with a signed URL, or 404 while there is no CURRENT pdf yet.
 *
 * The PDF lives in the PRIVATE `documents` bucket, so a URL can only come from the API
 * (the service-role key must never reach a browser) — same shape as challanActions.ts.
 */

import { apiCall } from "@/lib/apiFetch";

export interface QuotePdfResult {
  error: string | null;
  /** True for the EXPECTED 404: never rendered, rendering now, or edited since. */
  notReady?: boolean;
  url?: string;
  filename?: string;
  /** Seconds the signed URL stays valid — the UI states it, never hardcodes it. */
  expiresIn?: number;
}

export async function getQuotePdfAction(quoteId: string): Promise<QuotePdfResult> {
  const { data, error, status } = await apiCall<{
    url: string;
    quote_no: string;
    filename: string;
    expires_in: number;
  }>(`/api/quotations/${quoteId}/pdf`);
  if (error || !data) {
    return { error: error ?? "Could not get the quotation PDF", notReady: status === 404 };
  }
  return { error: null, url: data.url, filename: data.filename, expiresIn: data.expires_in };
}

export async function renderQuotePdfAction(quoteId: string): Promise<{ error: string | null }> {
  const { data, error } = await apiCall<{ status: string }>(`/api/quotations/${quoteId}/pdf`, {
    method: "POST",
  });
  if (error || !data) return { error: error ?? "Could not start preparing the PDF" };
  return { error: null };
}
