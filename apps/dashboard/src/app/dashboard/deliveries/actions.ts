"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";

export async function scheduleDeliveryAction(
  orderId: string,
  scheduledDate: string,
  driverId?: string,
  vehicleNo?: string,
  ewayBillNo?: string,
  notes?: string,
): Promise<{ error: string | null; deliveryId?: string }> {
  const sp = await getCurrentSalesperson();
  if (!sp) return { error: "Authentication required" };
  if (!orderId) return { error: "Select an order to deliver" };
  if (!scheduledDate) return { error: "Pick a delivery date" };

  try {
    const supabase = await createServerSupabaseClient();

    const { data: inserted, error: insertErr } = await supabase
      .from("deliveries")
      .insert({
        order_id: orderId,
        driver_salesperson_id: driverId || sp.id,
        scheduled_date: scheduledDate,
        vehicle_no: vehicleNo?.trim() || null,
        eway_bill_no: ewayBillNo?.trim() || null,
        notes: notes?.trim() || null,
        status: "scheduled",
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return { error: insertErr?.message || "Failed to schedule delivery" };
    }

    revalidatePath("/dashboard/deliveries");
    revalidatePath(`/dashboard/orders/${orderId}`);
    revalidatePath("/delivery");

    return { error: null, deliveryId: inserted.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
