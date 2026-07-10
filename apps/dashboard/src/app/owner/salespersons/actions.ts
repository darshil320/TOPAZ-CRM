"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const E164 = /^\+[1-9]\d{7,14}$/;

export async function addSalesperson(
  name: string,
  whatsapp: string,
  role: "salesperson" | "owner",
): Promise<{ error: string | null }> {
  const cleanName = name.trim();
  const cleanWhatsapp = whatsapp.trim();

  if (!cleanName) return { error: "Name is required" };
  if (!E164.test(cleanWhatsapp)) {
    return { error: "WhatsApp number must be E.164, e.g. +919426529230" };
  }
  if (role !== "salesperson" && role !== "owner") {
    return { error: `Invalid role: ${role}` };
  }

  try {
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
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from("salespersons")
      .update({ active })
      .eq("id", salespersonId);

    if (error) return { error: error.message };
    revalidatePath("/owner/salespersons");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
