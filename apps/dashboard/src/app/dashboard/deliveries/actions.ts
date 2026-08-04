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
  if (message.includes("You may not schedule a delivery for order")) {
    // 0040 raises this per order, naming the one that was refused — pass it through: it is
    // already the most actionable sentence available, and hiding which order was the
    // problem would make a mixed-order basket impossible to fix.
    return `${message}. It belongs to another salesperson's customer — ask the owner or an admin to schedule it.`;
  }
  if (message.includes("row-level security")) {
    return "You do not have permission to schedule a delivery for one of these orders — it belongs to another salesperson's customer. Ask the owner or an admin to schedule it.";
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
  if (message.includes("does not exist") && message.includes("Item ")) {
    return "One of the selected items no longer exists — refresh the page and pick again.";
  }
  if (message.includes("No goods on this delivery belong to customer")) {
    return "A delivery address was filled in for a customer who has nothing on this run — refresh the page and pick again.";
  }
  if (message.includes("Select at least one item")) {
    return "Select at least one item to deliver.";
  }
  if (message.includes("The same item was selected twice")) {
    return "The same item was picked twice — refresh the page and pick again.";
  }
  if (message.includes("schedule_delivery") && message.includes("does not exist")) {
    return "Multi-order deliveries are not enabled on this database yet — migration 0040 has not been applied.";
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

/** The challan fields for one recipient on the run. */
export interface ConsignmentInput {
  customerId: string;
  deliveryAddress?: string;
  deliveryRent?: string;
  dpCode?: string;
}

export interface ScheduleDeliveryInput {
  scheduledDate: string;
  /** order_items.id — MAY SPAN SEVERAL ORDERS AND SEVERAL CUSTOMERS (0040). */
  itemIds: string[];
  driverId?: string;
  vehicleNo?: string;
  ewayBillNo?: string;
  notes?: string;
  /** One entry per distinct customer in the basket; each becomes that customer's challan. */
  consignments?: ConsignmentInput[];
  /**
   * Every order the basket draws from, for cache revalidation only — never for
   * authorization. The server derives the real order set from the items.
   */
  orderIds?: string[];
}

/**
 * Schedule ONE LORRY RUN carrying a specific set of items (0040).
 *
 * ─── WHY AN RPC AND NOT SEVERAL INSERTS ───────────────────────────────────────
 * `deliveries` + `delivery_consignments` + `delivery_items` must be written together or not
 * at all. The Supabase client cannot open a transaction, so inserts from here would leave a
 * run with no items — which used to read as "the whole order" — or goods with no challan.
 *
 * `schedule_delivery` is SECURITY DEFINER and authorizes EVERY order in the basket itself,
 * because a with-check on the deliveries header cannot see items that do not exist yet. So
 * the checks below are for a fast, specific message only; the function re-validates all of
 * them, which is what matters — a Server Action is callable RPC.
 */
export async function scheduleDeliveryAction(
  input: ScheduleDeliveryInput,
): Promise<{ error: string | null; deliveryId?: string }> {
  const sp = await getCurrentSalesperson();
  if (!sp) return { error: "Authentication required" };

  const { scheduledDate, itemIds } = input;
  if (!scheduledDate) return { error: "Pick a delivery date" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return { error: "Delivery date is not a valid date" };
  }
  if (itemIds.length === 0) return { error: "Select at least one item to deliver" };
  if (new Set(itemIds).size !== itemIds.length) {
    return { error: "The same item was picked twice — refresh the page and pick again." };
  }

  try {
    const supabase = await createServerSupabaseClient();

    const { data: deliveryId, error: rpcErr } = await supabase.rpc("schedule_delivery", {
      p_delivery: {
        scheduled_date: scheduledDate,
        driver_salesperson_id: input.driverId || sp.id,
        vehicle_no: input.vehicleNo?.trim() || null,
        eway_bill_no: input.ewayBillNo?.trim() || null,
        notes: input.notes?.trim() || null,
        items: itemIds,
        // Paperwork per recipient. The consignments themselves are derived from the goods
        // server-side, so an omitted entry still gets a challan — it is just blank, which
        // is what their pad looks like before somebody writes on it. A rent that is not a
        // number is sent as null rather than 0: printing "0/-" would assert a free
        // delivery nobody agreed to.
        consignments: (input.consignments ?? [])
          .filter((consignment) => consignment.customerId)
          .map((consignment) => ({
            customer_id: consignment.customerId,
            delivery_address: consignment.deliveryAddress?.trim() || null,
            delivery_rent: parseRent(consignment.deliveryRent),
            dp_code: consignment.dpCode?.trim() || null,
          })),
      },
    });

    if (rpcErr || !deliveryId) {
      return { error: humanizeWriteError(rpcErr?.message ?? "Failed to schedule delivery") };
    }

    revalidatePath("/dashboard/deliveries");
    revalidatePath("/delivery");
    // Every order on the run has a page showing its runs — revalidate all of them, not
    // just one. Missing any would leave a stale "Deliveries & Challans" card.
    for (const orderId of new Set(input.orderIds ?? [])) {
      revalidatePath(`/dashboard/orders/${orderId}`);
    }

    return { error: null, deliveryId: deliveryId as string };
  } catch (err) {
    return { error: err instanceof Error ? humanizeWriteError(err.message) : "Server error" };
  }
}
