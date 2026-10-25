"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";

const E164 = /^\+[1-9]\d{7,14}$/;

// Mirrors salespersons_role_check (migrations 0011, 0051, 0052) exactly — the DB is the source
// of truth, this is just so a typo here fails at compile time instead of a 500 at insert.
export type StaffRole =
  | "salesperson" | "owner" | "admin" | "accounts" | "workshop_manager" | "delivery" | "telecaller"
  | "super_admin" | "front_desk";
const STAFF_ROLES: readonly StaffRole[] = [
  "salesperson", "owner", "admin", "accounts", "workshop_manager", "delivery", "telecaller",
  "super_admin", "front_desk",
];

/**
 * Who may manage staff: owner-level only (sp_owner_manage RLS); an admin views the team
 * but changes nothing. Only a super_admin may grant super_admin — the 0052 trigger
 * enforces both; this answers with a readable message instead of an RLS error.
 */
async function staffManagerError(role?: StaffRole): Promise<string | null> {
  const caller = await getCurrentSalesperson();
  if (!isOwnerRole(caller)) return "Only the owner can manage staff";
  if (role === "super_admin" && caller?.role !== "super_admin") {
    return "Only a super admin can add a super admin";
  }
  return null;
}

export async function addSalesperson(
  name: string,
  whatsapp: string,
  role: StaffRole,
): Promise<{ error: string | null }> {
  const cleanName = name.trim();
  const cleanWhatsapp = whatsapp.trim();

  if (!cleanName) return { error: "Name is required" };
  if (!E164.test(cleanWhatsapp)) {
    return { error: "WhatsApp number must be E.164, e.g. +919426529230" };
  }
  if (!STAFF_ROLES.includes(role)) {
    return { error: `Invalid role: ${role}` };
  }

  try {
    const denied = await staffManagerError(role);
    if (denied) return { error: denied };
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from("salespersons")
      .insert({ name: cleanName, whatsapp: cleanWhatsapp, role, active: true });

    if (error) return { error: error.message };
    revalidatePath("/owner/salespersons");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function setSalespersonActive(
  salespersonId: string,
  active: boolean,
): Promise<{ error: string | null }> {
  try {
    const denied = await staffManagerError();
    if (denied) return { error: denied };
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("salespersons")
      .update({ active })
      .eq("id", salespersonId)
      .select("id");

    if (error) return { error: error.message };
    // RLS turns a forbidden update into "0 rows", not an error — report it, or the toggle
    // shows success for a change that never happened.
    if (!data || data.length === 0) return { error: "You cannot change this staff member" };
    revalidatePath("/owner/salespersons");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
