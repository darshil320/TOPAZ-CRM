"use server";

/**
 * Mediator-app server actions — the courier's four taps.
 *
 * Thin wrappers over `/api/transfers/{id}/…`. Every rule lives server-side: the legal
 * predecessor of each edge, who may drive this consignment, and the photo requirement at
 * pickup and delivery. This file must not re-implement any of it — a Server Action is
 * callable RPC, so a check that lives only here is a check that can be skipped.
 *
 * Note what is NOT here: `receive`. Custody is accepted by the DESTINATION LEAD in the
 * workshop app, never by the courier (module 14 D10). One person confirming both ends of
 * a handover is exactly what makes a lost consignment unattributable.
 */

import { revalidatePath } from "next/cache";
import { apiCall } from "@/lib/apiFetch";

export interface StepResult {
  error: string | null;
  status?: string;
}

function revalidateTransit() {
  revalidatePath("/transit");
  revalidatePath("/workshop");
  revalidatePath("/dashboard/production");
}

async function step(
  transferId: string,
  edge: "pickup" | "in-transit" | "deliver",
  body: { media_id?: string | null; note?: string | null; vehicle_no?: string | null },
): Promise<StepResult> {
  const { data, error } = await apiCall<{ status: string }>(
    `/api/transfers/${transferId}/${edge}`,
    { method: "POST", body },
  );
  if (error || !data) return { error: error ?? "Could not update this run" };
  revalidateTransit();
  return { error: null, status: data.status };
}

/** "I have the goods." Photo required — the origin's proof of the condition they left in. */
export async function pickupAction(
  transferId: string,
  mediaId: string,
  vehicleNo?: string,
  note?: string,
): Promise<StepResult> {
  if (!mediaId) return { error: "માલનો ફોટો પાડો / Take a photo of the goods first" };
  return step(transferId, "pickup", {
    media_id: mediaId,
    vehicle_no: vehicleNo?.trim() || null,
    note: note ?? null,
  });
}

/** "On the road." No photo — nothing has changed hands, only location. */
export async function inTransitAction(transferId: string, note?: string): Promise<StepResult> {
  return step(transferId, "in-transit", { note: note ?? null });
}

/**
 * "I dropped it at the destination." Photo required.
 *
 * This does NOT complete the handover — the destination lead still has to receive it.
 * The run leaves the courier's list here.
 */
export async function deliverAction(
  transferId: string,
  mediaId: string,
  note?: string,
): Promise<StepResult> {
  if (!mediaId) return { error: "પહોંચાડ્યાનો ફોટો પાડો / Photograph the delivered goods" };
  return step(transferId, "deliver", { media_id: mediaId, note: note ?? null });
}
