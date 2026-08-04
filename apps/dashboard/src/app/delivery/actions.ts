"use server";

/**
 * Driver PWA — "the goods are installed" is one tap, and it must either happen
 * completely or say why it did not.
 *
 * The order-status flip and the audit row are NOT written here. A `delivery`
 * user has no UPDATE policy on `orders` and no INSERT grant on `audit_log`, so
 * the previous version's writes were rejected silently — nothing read their
 * errors. Both now happen inside the `deliveries_completed` trigger (migration
 * 0033), which runs SECURITY DEFINER off the single delivery UPDATE below.
 *
 * The proof photo needs no write here either: the media row created by the
 * upload already points at (entity_type='delivery', entity_id=deliveryId).
 */

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";

export async function completeDeliveryAction(
  deliveryId: string,
  notes?: string,
): Promise<{ error: string | null }> {
  const sp = await getCurrentSalesperson();
  if (!sp) return { error: "Authentication required" };
  if (!deliveryId) return { error: "Missing delivery" };

  try {
    const supabase = await createServerSupabaseClient();

    const { data: delivery, error: readErr } = await supabase
      .from("deliveries")
      .select("id, order_id, status")
      .eq("id", deliveryId)
      .maybeSingle();

    if (readErr) return { error: `Could not load this delivery: ${readErr.message}` };
    if (!delivery) return { error: "Delivery not found — pull down to refresh your queue" };
    if (delivery.status === "delivered") return { error: null }; // idempotent: already done

    const { data: updated, error: updateErr } = await supabase
      .from("deliveries")
      .update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
        notes: notes?.trim() || null,
      })
      .eq("id", deliveryId)
      .select("id")
      .maybeSingle();

    if (updateErr) {
      return { error: `Could not mark this delivered: ${updateErr.message}` };
    }
    // No error and no row ⇒ RLS filtered the UPDATE out. Say so, rather than
    // reporting a success the driver will see undone on the next refresh.
    if (!updated) {
      return {
        error:
          "आप इस डिलीवरी के ड्राइवर नहीं हैं / You are not the assigned driver for this delivery — ask the office to reassign it.",
      };
    }

    revalidatePath("/delivery");
    revalidatePath("/dashboard/deliveries");
    revalidatePath(`/dashboard/orders/${delivery.order_id}`);

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to complete delivery" };
  }
}
