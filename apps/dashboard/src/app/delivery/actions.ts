"use server";

/**
 * Driver PWA — "the goods are installed" is one tap, and it must either happen
 * completely or say why it did not.
 *
 * The order-status flip and the audit row are NOT written here. A `delivery`
 * user has no UPDATE policy on `orders` and no INSERT grant on `audit_log`, so
 * the previous version's writes were rejected silently — nothing read their
 * errors. Both now happen inside the `deliveries_completed` trigger (migrations
 * 0033/0039/0040), which runs SECURITY DEFINER off the single delivery UPDATE
 * below and advances EVERY order the run touched, each on its own remaining count.
 *
 * The proof photo needs no write here either: the media row created by the
 * upload already points at (entity_type='delivery', entity_id=deliveryId).
 */

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";

/**
 * Record WHICH pieces actually changed hands, before the run is closed (0040).
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Until 0040 the driver's checklist lived only in React state and was thrown away on
 * submit: the app asked "which items did you hand over", the driver answered, and nothing
 * was written. "The customer got 2 of the 3 pieces" was therefore never recorded anywhere,
 * and `order_items.delivered_at` was stamped for the whole run regardless.
 *
 * `received` defaults to TRUE in the database, so this action only ever needs to write the
 * FALSES — and it writes them before the status flip, because the completion trigger reads
 * the column to decide what to stamp. Ordering here is load-bearing.
 *
 * `delivery_items` grants UPDATE on the `received` column only, so this cannot repoint a
 * line at another item or another challan even if it tried.
 */
export async function markItemsReceivedAction(
  deliveryId: string,
  notReceivedLineIds: string[],
): Promise<{ error: string | null }> {
  const sp = await getCurrentSalesperson();
  if (!sp) return { error: "Authentication required" };
  if (!deliveryId) return { error: "Missing delivery" };

  try {
    const supabase = await createServerSupabaseClient();

    // Everything on the run starts as received; only the short items are flipped. Written
    // as two scoped statements rather than one per line so a 12-piece run is two round
    // trips, not twelve.
    const { error: resetErr } = await supabase
      .from("delivery_items")
      .update({ received: true })
      .eq("delivery_id", deliveryId);
    if (resetErr) {
      return { error: `Could not save the item checklist: ${resetErr.message}` };
    }

    if (notReceivedLineIds.length > 0) {
      const { error: shortErr } = await supabase
        .from("delivery_items")
        .update({ received: false })
        .eq("delivery_id", deliveryId)
        .in("id", notReceivedLineIds);
      if (shortErr) {
        return { error: `Could not save the item checklist: ${shortErr.message}` };
      }
    }

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save the checklist" };
  }
}

export async function completeDeliveryAction(
  deliveryId: string,
  notes?: string,
  notReceivedLineIds: string[] = [],
): Promise<{ error: string | null }> {
  const sp = await getCurrentSalesperson();
  if (!sp) return { error: "Authentication required" };
  if (!deliveryId) return { error: "Missing delivery" };

  try {
    const supabase = await createServerSupabaseClient();

    const { data: delivery, error: readErr } = await supabase
      .from("deliveries")
      .select("id, status, delivery_items(order_id)")
      .eq("id", deliveryId)
      .maybeSingle();

    if (readErr) return { error: `Could not load this delivery: ${readErr.message}` };
    if (!delivery) return { error: "Delivery not found — pull down to refresh your queue" };
    if (delivery.status === "delivered") return { error: null }; // idempotent: already done

    // BEFORE the status flip: the completion trigger reads `received` to decide which
    // pieces to stamp, so a checklist saved afterwards would arrive too late to matter.
    const checklist = await markItemsReceivedAction(deliveryId, notReceivedLineIds);
    if (checklist.error) return checklist;

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
    // A run can carry several orders (0040) — every one of their pages shows it, so
    // revalidate all of them rather than a single one.
    const orderIds = new Set(
      ((delivery.delivery_items ?? []) as { order_id: string | null }[])
        .map((line) => line.order_id)
        .filter((orderId): orderId is string => Boolean(orderId)),
    );
    for (const orderId of orderIds) {
      revalidatePath(`/dashboard/orders/${orderId}`);
    }

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to complete delivery" };
  }
}
