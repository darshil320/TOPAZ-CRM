"use server";

/**
 * Workshop staff + route-template server actions (module 14), owner/admin only.
 *
 * All writes go through FastAPI, not Supabase-direct, for a reason the roster makes
 * unavoidable: appointing a LEAD is deactivate-then-insert in ONE transaction
 * (`workshop_staff_one_active_lead` is a plain partial unique index, so appointing
 * before retiring fails), and the API owns that sequence. Two browser round trips
 * would fail in the middle and leave the workshop with no lead.
 */

import { revalidatePath } from "next/cache";
import { apiCall } from "@/lib/apiFetch";

export interface StaffRow {
  id: string;
  salesperson_id: string;
  role: "lead" | "sub";
  active: boolean;
  salesperson_name: string;
  salesperson_whatsapp: string | null;
  salesperson_role: string;
  created_at: string;
}

export interface StaffResult {
  error: string | null;
  staff?: StaffRow[];
}

function revalidateAdmin() {
  revalidatePath("/owner/admin");
  revalidatePath("/workshop");
}

/**
 * Appoint someone. `role: "lead"` implicitly retires the incumbent lead — that IS what
 * promotion means, and the API does it atomically.
 */
export async function appointStaff(
  workshopId: string,
  salespersonId: string,
  role: "lead" | "sub",
): Promise<StaffResult> {
  if (!salespersonId) return { error: "Pick a staff member first" };

  const { data, error } = await apiCall<{ staff: StaffRow[] }>(
    `/api/workshops/${workshopId}/staff`,
    { method: "POST", body: { salesperson_id: salespersonId, role } },
  );
  if (error || !data) return { error: error ?? "Could not update the roster" };
  revalidateAdmin();
  return { error: null, staff: data.staff };
}

/**
 * Retire a roster row. The API refuses to remove the LAST lead of a workshop that still
 * holds unfinished items — nobody would then be able to receive goods there, and a
 * consignment would sit on a lorry with no one authorised to accept it.
 */
export async function removeStaff(
  workshopId: string,
  salespersonId: string,
): Promise<StaffResult> {
  const { data, error } = await apiCall<{ staff: StaffRow[] }>(
    `/api/workshops/${workshopId}/staff/${salespersonId}/deactivate`,
    { method: "POST" },
  );
  if (error || !data) return { error: error ?? "Could not update the roster" };
  revalidateAdmin();
  return { error: null, staff: data.staff };
}

export interface TemplateLegInput {
  workshop_id: string;
  stage_from: string;
  stage_to: string;
  planned_days: number;
}

/**
 * Create a reusable route ("Polishing 5d at Sharma → Finishing 4d at Main Floor").
 *
 * The API validates the leg cover exactly as it validates a real route: a template that
 * cannot be applied to anything is a trap that only surfaces weeks later, at the
 * allocate screen, in front of a customer.
 */
export async function createRouteTemplate(
  name: string,
  legs: TemplateLegInput[],
  notes?: string,
): Promise<{ error: string | null }> {
  if (!name.trim()) return { error: "Give the route a name" };
  if (legs.length === 0) return { error: "A route needs at least one leg" };

  const { error } = await apiCall<{ id: string }>("/api/routing/templates", {
    method: "POST",
    body: { name: name.trim(), notes: notes?.trim() || null, legs },
  });
  if (error) return { error };
  revalidatePath("/owner/admin");
  revalidatePath("/dashboard/production/allocate");
  return { error: null };
}

export async function deactivateRouteTemplate(
  templateId: string,
): Promise<{ error: string | null }> {
  const { error } = await apiCall<{ id: string }>(
    `/api/routing/templates/${templateId}/deactivate`,
    { method: "POST" },
  );
  if (error) return { error };
  revalidatePath("/owner/admin");
  revalidatePath("/dashboard/production/allocate");
  return { error: null };
}
