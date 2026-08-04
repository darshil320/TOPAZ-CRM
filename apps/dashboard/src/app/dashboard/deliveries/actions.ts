"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";

/**
 * "new row violates row-level security policy for table X" is Postgres telling
 * the truth to the wrong audience — a showroom manager cannot act on it. Every
 * write in this file translates it into the one thing they can do about it.
 */
function humanizeWriteError(message: string): string {
  if (message.includes("row-level security")) {
    return "You do not have permission to schedule a delivery for this order — it belongs to another salesperson's customer. Ask the owner or an admin to schedule it.";
  }
  if (message.includes("permission denied")) {
    return "Delivery scheduling is not enabled on this database yet — migration 0033 has not been applied.";
  }
  return message;
}

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return { error: "Delivery date is not a valid date" };

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
      return { error: humanizeWriteError(insertErr?.message ?? "Failed to schedule delivery") };
    }

    revalidatePath("/dashboard/deliveries");
    revalidatePath(`/dashboard/orders/${orderId}`);
    revalidatePath("/delivery");

    return { error: null, deliveryId: inserted.id };
  } catch (err) {
    return { error: err instanceof Error ? humanizeWriteError(err.message) : "Server error" };
  }
}
