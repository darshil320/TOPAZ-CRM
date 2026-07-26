"use server";

/**
 * Workshop PWA server actions — thin wrappers over the production API.
 *
 * ─── WHAT THIS FILE USED TO DO, AND WHY IT STOPPED ────────────────────────────
 * Before module 09 existed, `advanceStageAction` inserted the `production_events`
 * row AND then re-wrote `order_items.current_stage`, `current_stage_at`, the blocked
 * flags and `orders.status` itself, from the browser session. That duplicated
 * `production_event_apply()` (migration 0024), which does all of it already, and it
 * skipped every server-side guard: stage order, actor-is-this-workshop, and the
 * photo_required rule (checked client-side only, so a crafted Server Action call
 * walked past it — Server Actions are callable RPC, not limited to what the UI sends).
 *
 * Module 14 adds three more guards that MUST NOT be bypassable: the item is not in
 * transit, the stage belongs to this workshop's route leg, and the caller has the
 * capability at that workshop. So all of it moved behind
 * `POST /api/production/items/{id}/…`, and this file is now a transport shim. The API
 * is the only writer of production state.
 */

import { revalidatePath } from "next/cache";
import { apiCall } from "@/lib/apiFetch";

export interface AdvanceResult {
  error: string | null;
  completedStage?: string | null;
  nextStage?: string | null;
  done?: boolean;
  /** Set when finishing this stage opened a consignment to the next workshop. */
  transfer?: {
    id: string;
    transfer_no: string;
    to_workshop_id: string;
    status: string;
    due_at: string | null;
  } | null;
}

/** Paths that show production state and must not serve a stale cache after a tap. */
function revalidateProduction(orderId?: string) {
  revalidatePath("/workshop");
  revalidatePath("/dashboard/production");
  revalidatePath("/transit");
  if (orderId) revalidatePath(`/dashboard/orders/${orderId}`);
}

export async function advanceStageAction(
  orderItemId: string,
  note?: string,
  mediaId?: string,
  expectedStage?: string,
): Promise<AdvanceResult> {
  const { data, error } = await apiCall<{
    completed_stage: string;
    next_stage: string | null;
    done: boolean;
    transfer: AdvanceResult["transfer"];
  }>(`/api/production/items/${orderItemId}/advance`, {
    method: "POST",
    body: {
      note: note ?? null,
      media_id: mediaId ?? null,
      // Sent so the API can refuse a tap made against a stale screen. It is CHECKED
      // there, never trusted as the stage to complete.
      stage_code: expectedStage ?? null,
    },
  });

  if (error || !data) return { error: error ?? "Could not update this stage" };

  revalidateProduction();
  return {
    error: null,
    completedStage: data.completed_stage,
    nextStage: data.next_stage,
    done: data.done,
    transfer: data.transfer,
  };
}

export async function toggleBlockAction(
  orderItemId: string,
  blocked: boolean,
  note?: string,
): Promise<{ error: string | null }> {
  if (blocked && !note?.trim()) {
    return { error: "Please provide a reason for blocking" };
  }

  const path = `/api/production/items/${orderItemId}/${blocked ? "block" : "unblock"}`;
  const { error } = await apiCall<{ blocked: boolean }>(path, {
    method: "POST",
    body: { note: note?.trim() || (blocked ? undefined : null) },
  });

  if (error) return { error };
  revalidateProduction();
  return { error: null };
}

/**
 * Hand the item to the next workshop on its route — LEAD ONLY (enforced by the API).
 *
 * Normally unnecessary: finishing a leg's last stage opens the consignment
 * automatically (module 14 D6). This is the manual override for handing over early
 * (a lorry is leaving now) or for a `rework`/`capacity` move that no route describes.
 */
export async function handoverAction(
  orderItemIds: string[],
  options?: {
    toWorkshopId?: string;
    reason?: "next_stage" | "rework" | "capacity" | "other";
    courierSalespersonId?: string;
    expectedPickupAt?: string;
    notes?: string;
  },
): Promise<{ error: string | null; transferNo?: string; transferId?: string }> {
  if (orderItemIds.length === 0) return { error: "Select at least one item to hand over" };

  const { data, error } = await apiCall<{
    transfer: { id: string; transfer_no: string };
    item_count: number;
  }>("/api/transfers", {
    method: "POST",
    body: {
      order_item_ids: orderItemIds,
      to_workshop_id: options?.toWorkshopId ?? null,
      reason: options?.reason ?? "next_stage",
      courier_salesperson_id: options?.courierSalespersonId ?? null,
      expected_pickup_at: options?.expectedPickupAt ?? null,
      notes: options?.notes ?? null,
    },
  });

  if (error || !data) return { error: error ?? "Could not create the consignment" };
  revalidateProduction();
  return { error: null, transferNo: data.transfer.transfer_no, transferId: data.transfer.id };
}

/**
 * Accept an incoming consignment — LEAD ONLY, photo required (both enforced by the API).
 *
 * This is the call that actually moves custody: the destination leg goes active, the
 * item's workshop flips, and the transit lock clears so stages can be ticked again.
 */
export async function receiveTransferAction(
  transferId: string,
  mediaId: string,
  note?: string,
): Promise<{ error: string | null; itemCount?: number }> {
  if (!mediaId) return { error: "Take a photo of the goods as they arrived" };

  const { data, error } = await apiCall<{ items: unknown[] }>(
    `/api/transfers/${transferId}/receive`,
    { method: "POST", body: { media_id: mediaId, note: note ?? null } },
  );

  if (error || !data) return { error: error ?? "Could not receive this consignment" };
  revalidateProduction();
  return { error: null, itemCount: data.items.length };
}
