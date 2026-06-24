"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const VALID_STAGES = new Set(["new", "talking", "follow_up", "won", "lost"]);

export async function moveStage(
  customerId: string,
  stage: string,
): Promise<{ error: string | null }> {
  if (!VALID_STAGES.has(stage)) {
    return { error: `Invalid stage: ${stage}` };
  }
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from("pipeline_stages")
      .upsert({ customer_id: customerId, stage }, { onConflict: "customer_id" });
    if (error) return { error: error.message };
    revalidatePath(`/dashboard/customers/${customerId}`);
    return { error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return { error: message };
  }
}
