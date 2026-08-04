"use server";

/**
 * Delivery challan — a transport shim over `/api/documents/challan/{id}` (0037).
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
  deliveryId: string,
  orderId?: string,
): Promise<{ error: string | null; challanNo?: string | null }> {
  const { data, error } = await apiCall<{ status: string; challan_no: string | null }>(
    `/api/documents/challan/${deliveryId}`,
    { method: "POST" },
  );
  if (error || !data) return { error: error ?? "Could not start the challan render" };

  revalidatePath("/dashboard/deliveries");
  if (orderId) revalidatePath(`/dashboard/orders/${orderId}`);
  return { error: null, challanNo: data.challan_no };
}

/**
 * The signed URL, if the PDF exists yet.
 *
 * A 404 here is the EXPECTED state for a few seconds after generating — the caller polls
 * rather than treating it as a failure.
 */
export async function getChallanUrlAction(deliveryId: string): Promise<ChallanResult> {
  const { data, error } = await apiCall<{
    url: string;
    challan_no: string | null;
    version: number;
  }>(`/api/documents/challan/${deliveryId}`);

  if (error || !data) return { error: error ?? "Challan not generated yet" };
  return { error: null, url: data.url, challanNo: data.challan_no };
}
