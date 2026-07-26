"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";

export async function completeDeliveryAction(
  deliveryId: string,
  notes?: string,
  mediaId?: string,
): Promise<{ error: string | null }> {
  const sp = await getCurrentSalesperson();
  if (!sp) return { error: "Authentication required" };

  try {
    const supabase = await createServerSupabaseClient();
    const now = new Date().toISOString();

    // 1. Fetch delivery details
    const { data: delivery } = await supabase
      .from("deliveries")
      .select("id, order_id")
      .eq("id", deliveryId)
      .single();

    if (!delivery) return { error: "Delivery record not found" };

    // 2. Mark delivery as delivered
    await supabase
      .from("deliveries")
      .update({
        status: "delivered",
        delivered_at: now,
        notes: notes?.trim() || null,
        updated_at: now,
      })
      .eq("id", deliveryId);

    // 3. Flip order status to delivered / closed
    await supabase
      .from("orders")
      .update({
        status: "delivered",
        updated_at: now,
      })
      .eq("id", delivery.order_id);

    // 4. Record audit log
    await supabase.from("audit_log").insert({
      entity: "orders",
      entity_id: delivery.order_id,
      action: "delivered",
      actor: sp.id,
      payload: { delivery_id: deliveryId, notes, media_id: mediaId },
    });

    revalidatePath("/delivery");
    revalidatePath("/dashboard/deliveries");
    revalidatePath(`/dashboard/orders/${delivery.order_id}`);

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to complete delivery" };
  }
}
