"use server";

import { apiCall } from "@/lib/apiFetch";
import { getCurrentSalesperson } from "@/lib/auth";
import { isDispatcher } from "@/lib/roles";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hand the new walk-in straight to a salesperson (0052). Uses the signed-in user's token,
 * so the API can check they are front desk / owner / admin — the kiosk's own API key
 * proves nothing about who is standing at it. Returns a line for the done screen.
 */
async function assignAfterEnroll(customerId: string, salespersonId: string): Promise<string | undefined> {
  // Only a signed-in dispatcher ever sees the picker; a salesperson_id arriving without
  // one is ignored (the API would refuse it anyway) rather than surfaced on a public screen.
  const sp = await getCurrentSalesperson();
  if (!sp || !isDispatcher(sp.role)) return undefined;
  if (!UUID_RE.test(customerId) || !UUID_RE.test(salespersonId)) return undefined;
  const { data, error } = await apiCall<{ assigned_to: { name: string } }>(
    `/api/frontdesk/walkins/${customerId}/assign`,
    { method: "POST", body: { salesperson_id: salespersonId } },
  );
  if (error || !data) {
    console.error("Kiosk assign failed", { customerId, salespersonId, error });
    return "Registered, but the salesperson could not be assigned — they are in the walk-in queue. "
      + "Assign them from the Front Desk.";
  }
  return `Assigned to ${data.assigned_to.name}.`;
}

export async function enrollCustomer(data: {
  name: string;
  phone: string;
  wa_id: string;
  primary_interest: string;
  interest_summary: string;
  face_tracking: boolean;
  personal_data: boolean;
  whatsapp_marketing: boolean;
  /** Front desk only: the salesperson to hand this walk-in to. Null = shared queue. */
  salesperson_id?: string | null;
}): Promise<{
  success: boolean;
  error: string | null;
  customerId?: string;
  assignNotice?: string;
}> {
  const apiUrl = process.env.TOPAZ_API_URL;
  const apiKey = process.env.DASHBOARD_API_KEY;

  if (!apiUrl) {
    return { success: false, error: "TOPAZ_API_URL is not configured." };
  }
  if (!apiKey) {
    return { success: false, error: "DASHBOARD_API_KEY is not configured." };
  }

  try {
    const response = await fetch(`${apiUrl}/api/enrollment`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "API-Key": apiKey,
      },
      body: JSON.stringify({
        name: data.name || null,
        phone: data.phone || null,
        wa_id: data.wa_id || null,
        primary_interest: data.primary_interest || null,
        interest_summary: data.interest_summary || null,
        face_tracking: data.face_tracking,
        personal_data: data.personal_data,
        whatsapp_marketing: data.whatsapp_marketing,
        camera_id: "kiosk",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      let message = `API error ${response.status}`;
      try {
        const json = JSON.parse(text);
        message = json.detail ?? json.error ?? message;
      } catch {
        if (text) message = text;
      }
      return { success: false, error: message };
    }

    const body = await response.json();
    // The registration itself already succeeded; a failed assign only leaves the walk-in
    // in the shared queue, so it is reported, never turned into a failed sign-up.
    const assignNotice =
      data.salesperson_id && body.customer_id
        ? await assignAfterEnroll(body.customer_id, data.salesperson_id)
        : undefined;
    return { success: true, error: null, customerId: body.customer_id, assignNotice };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error during enrollment.";
    return { success: false, error: message };
  }
}
