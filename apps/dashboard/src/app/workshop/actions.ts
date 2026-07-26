"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";

export interface AdvanceResult {
  error: string | null;
  nextStage?: string | null;
  done?: boolean;
}

export async function advanceStageAction(
  orderItemId: string,
  note?: string,
  mediaId?: string,
): Promise<AdvanceResult> {
  const sp = await getCurrentSalesperson();
  if (!sp) return { error: "Authentication required" };

  try {
    const supabase = await createServerSupabaseClient();

    // 1. Fetch current item state & stage sort
    const { data: item } = await supabase
      .from("order_items")
      .select("id, current_stage, order_id, orders(status)")
      .eq("id", orderItemId)
      .single();

    if (!item) return { error: "Order item not found" };

    // 2. Fetch all stage definitions ordered by sort
    const { data: stages } = await supabase
      .from("production_stage_defs")
      .select("code, sort, photo_required")
      .eq("active", true)
      .order("sort", { ascending: true });

    if (!stages || stages.length === 0) return { error: "No production stages defined" };

    const currentCode = item.current_stage || stages[0].code;
    const currentIndex = stages.findIndex((s) => s.code === currentCode);
    const currentStageDef = stages[currentIndex];

    // Enforce photo required check if stage mandates photo
    if (currentStageDef?.photo_required && !mediaId) {
      return { error: `Photo is required for stage '${currentStageDef.code}'` };
    }

    const nextStageDef = stages[currentIndex + 1];
    const isFinished = !nextStageDef;
    const now = new Date().toISOString();

    // 3. Insert production event (done)
    await supabase.from("production_events").insert({
      order_item_id: orderItemId,
      kind: "done",
      stage_code: currentCode,
      note: note || null,
      media_id: mediaId || null,
      actor: sp.id,
    });

    // 4. Update order item
    if (isFinished) {
      await supabase
        .from("order_items")
        .update({
          production_done_at: now,
          current_stage_at: now,
          blocked: false,
          blocked_at: null,
        })
        .eq("id", orderItemId);
    } else {
      await supabase
        .from("order_items")
        .update({
          current_stage: nextStageDef.code,
          current_stage_at: now,
          blocked: false,
          blocked_at: null,
        })
        .eq("id", orderItemId);
    }

    // 5. Update order status if needed
    const orderObj = Array.isArray(item.orders) ? item.orders[0] : item.orders;
    if (orderObj?.status === "confirmed") {
      await supabase
        .from("orders")
        .update({ status: "in_production", updated_at: now })
        .eq("id", item.order_id);
    }

    // Check if all order items are finished
    const { data: unfinished } = await supabase
      .from("order_items")
      .select("id")
      .eq("order_id", item.order_id)
      .is("production_done_at", null);

    if (!unfinished || unfinished.length === 0) {
      await supabase
        .from("orders")
        .update({ status: "ready", updated_at: now })
        .eq("id", item.order_id);
    }

    revalidatePath("/workshop");
    revalidatePath("/dashboard/production");
    revalidatePath(`/dashboard/orders/${item.order_id}`);

    return {
      error: null,
      nextStage: isFinished ? null : nextStageDef.code,
      done: isFinished,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to advance stage" };
  }
}

export async function toggleBlockAction(
  orderItemId: string,
  blocked: boolean,
  note?: string,
): Promise<{ error: string | null }> {
  const sp = await getCurrentSalesperson();
  if (!sp) return { error: "Authentication required" };
  if (blocked && !note?.trim()) return { error: "Please provide a reason for blocking" };

  try {
    const supabase = await createServerSupabaseClient();
    const now = new Date().toISOString();

    await supabase.from("production_events").insert({
      order_item_id: orderItemId,
      kind: blocked ? "blocked" : "unblocked",
      stage_code: "design_approved",
      note: note?.trim() || null,
      actor: sp.id,
    });

    await supabase
      .from("order_items")
      .update({
        blocked,
        blocked_at: blocked ? now : null,
      })
      .eq("id", orderItemId);

    revalidatePath("/workshop");
    revalidatePath("/dashboard/production");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
