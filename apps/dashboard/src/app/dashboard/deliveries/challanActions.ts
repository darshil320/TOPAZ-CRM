"use server";

/**
 * Delivery challan — a transport shim over `/api/documents/challan/…` (0037, per-consignment
 * since 0040).
 *
 * ─── THE UNIT IS A CONSIGNMENT, NOT A DELIVERY ────────────────────────────────
 * A run can carry goods for two customers, and each recipient signs their own paper. So a
 * mixed-customer run has TWO challans and the id in these calls is the consignment's, not
 * the delivery's. One recipient's several orders still share one document.
 *
 * Two calls, because rendering runs a headless browser and takes seconds:
 *   generate → 202 (queued)
 *   fetch    → 200 with a short-lived signed URL, or 404 while it is still rendering.
 *
 * The PDF lives in the PRIVATE `documents` bucket, so a URL can only come from the API
 * (the service-role key must never reach a browser) — the same shape the receipt download
 * button already uses.
 */

import { revalidatePath } from "next/cache";
import { apiCall } from "@/lib/apiFetch";

export interface ChallanResult {
  error: string | null;
  url?: string;
  challanNo?: string | null;
}

export async function generateChallanAction(
  consignmentId: string,
  orderIds?: string[],
): Promise<{ error: string | null; challanNo?: string | null }> {
  const { data, error } = await apiCall<{ status: string; challan_no: string | null }>(
    `/api/documents/challan/${consignmentId}`,
    { method: "POST" },
  );
  if (error || !data) return { error: error ?? "Could not start the challan render" };

  revalidatePath("/dashboard/deliveries");
  // A challan can cover several of the customer's orders, so every one of their pages shows
  // it. Revalidating only the first would leave the others showing "Generate challan".
  for (const orderId of new Set(orderIds ?? [])) {
    revalidatePath(`/dashboard/orders/${orderId}`);
  }
  return { error: null, challanNo: data.challan_no };
}

/**
 * The signed URL, if the PDF exists yet.
 *
 * A 404 here is the EXPECTED state for a few seconds after generating — the caller polls
 * rather than treating it as a failure. The API falls back to the pre-0040 document key, so
 * a challan rendered before this change is still found.
 */
export async function getChallanUrlAction(consignmentId: string): Promise<ChallanResult> {
  const { data, error } = await apiCall<{
    url: string;
    challan_no: string | null;
    version: number;
  }>(`/api/documents/challan/${consignmentId}`);

  if (error || !data) return { error: error ?? "Challan not generated yet" };
  return { error: null, url: data.url, challanNo: data.challan_no };
}
