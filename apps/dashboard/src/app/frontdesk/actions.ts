"use server";

/**
 * Front desk writes (0052) — a transport shim over `/api/frontdesk/…`.
 *
 * Assigning goes through the API, not straight to Supabase: it must refuse a customer
 * claimed a moment ago or one who withdrew consent, in one transaction, and the front
 * desk has no RLS write on customer_assignments. The API's authz.assert_dispatcher is
 * the gate.
 */

import { revalidatePath } from "next/cache";
import { apiCall } from "@/lib/apiFetch";

// Ids are interpolated into the API path; anything but a UUID is refused before it can
// steer the request (with our API key and the caller's token) to another route.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function assignWalkinAction(
  customerId: string,
  salespersonId: string,
): Promise<{ error: string | null; assignedTo?: string }> {
  if (!salespersonId) return { error: "Choose a salesperson" };
  if (!UUID_RE.test(customerId) || !UUID_RE.test(salespersonId)) return { error: "Invalid request" };
  const { data, error } = await apiCall<{ assigned_to: { name: string } }>(
    `/api/frontdesk/walkins/${customerId}/assign`,
    { method: "POST", body: { salesperson_id: salespersonId } },
  );
  if (error || !data) return { error: error ?? "Could not assign the walk-in" };
  revalidatePath("/frontdesk");
  revalidatePath("/dashboard/walkins");
  return { error: null, assignedTo: data.assigned_to.name };
}
