"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function claimCustomer(
  customerId: string,
): Promise<{ error: string | null; won?: boolean }> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { data: won, error } = await supabase.rpc("claim_customer", {
      p_customer_id: customerId,
    });
    if (error) return { error: error.message };

    revalidatePath("/dashboard/walkins");
    revalidatePath("/dashboard");
    return { error: null, won: won ?? false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return { error: message };
  }
}
