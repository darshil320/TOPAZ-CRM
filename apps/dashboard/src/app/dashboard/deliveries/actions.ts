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
  // The partial unique index delivery_items_one_open (0039) fired: somebody scheduled one
  // of these items onto another run since this page loaded. Refreshing is the fix — the
  // item will then show as ineligible with its reason.
  if (
    message.includes("delivery_items_one_open") ||
    message.includes("duplicate key value")
  ) {
    return "One of these items is already on another open delivery — refresh the page and pick again.";
  }
  if (message.includes("does not belong to this order")) {
    return "One of the selected items is not on this order — refresh the page and pick again.";
  }
  if (message.includes("Select at least one item")) {
    return "Select at least one item to deliver.";
  }
  if (message.includes("schedule_delivery") && message.includes("does not exist")) {
    return "Item-level deliveries are not enabled on this database yet — migration 0039 has not been applied.";
  }
  return message;
}

/** Rupees as typed → a number, or null when the field is blank or not a number. */
function parseRent(value?: string): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Schedule a delivery for a SPECIFIC SET OF ITEMS (0039).
 *
 * ─── WHY AN RPC AND NOT TWO INSERTS ───────────────────────────────────────────
 * `deliveries` + `delivery_items` must be written together or not at all. The Supabase
 * client cannot open a transaction, so two inserts from here would leave a delivery with
 * no item rows whenever the second one failed — and a delivery with no items reads as
 * "the whole order", which is precisely the bug this replaces. `schedule_delivery` is
 * SECURITY INVOKER, so 0033's RLS policies are still what authorize the write.
 */
export async function scheduleDeliveryAction(
  orderId: string,
  scheduledDate: string,
  itemIds: string[],
  driverId?: string,
  vehicleNo?: string,
  ewayBillNo?: string,
  notes?: string,
  deliveryAddress?: string,
  deliveryRent?: string,
  dpCode?: string,
): Promise<{ error: string | null; deliveryId?: string }> {
  const sp = await getCurrentSalesperson();
  if (!sp) return { error: "Authentication required" };
  if (!orderId) return { error: "Select an order to deliver" };
  if (!scheduledDate) return { error: "Pick a delivery date" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return { error: "Delivery date is not a valid date" };
  // Checked here for a fast, specific message; the function raises on it regardless,
  // because a Server Action is callable RPC and this check is not a security boundary.
  if (itemIds.length === 0) return { error: "Select at least one item to deliver" };

  try {
    const supabase = await createServerSupabaseClient();

    const { data: deliveryId, error: rpcErr } = await supabase.rpc("schedule_delivery", {
      p_order_id: orderId,
      p_scheduled_date: scheduledDate,
      p_driver: driverId || sp.id,
      p_item_ids: itemIds,
      p_vehicle_no: vehicleNo?.trim() || null,
      p_eway_bill_no: ewayBillNo?.trim() || null,
      p_notes: notes?.trim() || null,
      // The ship-to address printed on the challan (0037). Belongs to the DELIVERY, not
      // the customer: the same customer's next order may go to a different site.
      p_delivery_address: deliveryAddress?.trim() || null,
      // Both are lines on the client's challan (0037). A rent that is not a number is
      // sent as null rather than 0 — their pad leaves the line blank, and printing "0/-"
      // would assert a free delivery nobody agreed to.
      p_delivery_rent: parseRent(deliveryRent),
      p_dp_code: dpCode?.trim() || null,
    });

    if (rpcErr || !deliveryId) {
      return { error: humanizeWriteError(rpcErr?.message ?? "Failed to schedule delivery") };
    }

    revalidatePath("/dashboard/deliveries");
    revalidatePath(`/dashboard/orders/${orderId}`);
    revalidatePath("/delivery");

    return { error: null, deliveryId };
  } catch (err) {
    return { error: err instanceof Error ? humanizeWriteError(err.message) : "Server error" };
  }
}
