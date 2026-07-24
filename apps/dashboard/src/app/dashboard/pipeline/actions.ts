"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { BOARD_STAGES } from "./stages";

type PipelineStage = Database["public"]["Enums"]["pipeline_stage"];

const VALID = new Set<string>(BOARD_STAGES);

export async function moveCustomerStage(
  customerId: string,
  stage: string,
): Promise<{ error: string | null }> {
  if (!VALID.has(stage)) return { error: `Invalid stage: ${stage}` };
  try {
    const supabase = await createServerSupabaseClient();
    // RLS: only owner or an assigned salesperson may write the row.
    const { error } = await supabase
      .from("pipeline_stages")
      .upsert({ customer_id: customerId, stage: stage as PipelineStage }, { onConflict: "customer_id" });
    if (error) return { error: error.message };
    revalidatePath("/dashboard/pipeline");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
