"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function toggleAvailability(
  salespersonId: string,
  available: boolean
): Promise<{ error: string | null }> {
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from("salespersons")
      .update({ available })
      .eq("id", salespersonId);

    if (error) return { error: error.message };

    revalidatePath("/dashboard");
    return { error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return { error: message };
  }
}
