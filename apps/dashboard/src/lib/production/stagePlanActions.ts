"use server";

/**
 * Stage-schedule server actions — a transport shim over `/api/stage-plan` (0035).
 *
 * NOTHING IS VALIDATED HERE. A Server Action is callable RPC, not a form handler, so
 * "the days add up" is enforced by the API (services/stage_plan.validate_plan) on every
 * call. The client-side arithmetic in the editor exists to show the operator the overrun
 * live, and the server re-checks it regardless — the same split
 * `apps/dashboard/src/app/workshop/actions.ts` documents for stage advances.
 */

import { revalidatePath } from "next/cache";
import { apiCall } from "@/lib/apiFetch";
import type { StagePlanResponse, StagePlanRow } from "./types";

/**
 * Read one item's schedule from a CLIENT component.
 *
 * `getStagePlan` in reads.ts is server-only (it carries the API key), so the editor —
 * which opens on a click, long after the page rendered — reaches it through this action
 * rather than having its data threaded down from a server component that did not know
 * which item would be clicked.
 */
export async function loadStagePlanAction(
  orderItemId: string,
): Promise<{ error: string | null; plan?: StagePlanResponse }> {
  const { data, error } = await apiCall<StagePlanResponse>(
    `/api/stage-plan/items/${orderItemId}`,
  );
  if (error || !data) return { error: error ?? "Could not load this schedule" };
  return { error: null, plan: data };
}

export interface StagePlanInputRow {
  stage_code: string;
  planned_days: number | null;
  skipped: boolean;
  remind: boolean;
}

export interface SaveStagePlanResult {
  error: string | null;
  /** Every problem with the plan, so the editor can list them under the fields. */
  errors?: string[];
  plan?: StagePlanRow[];
  usedDays?: number;
  budgetDays?: number | null;
  remainingDays?: number | null;
}

function revalidatePlanPaths(orderId?: string) {
  revalidatePath("/workshop");
  revalidatePath("/dashboard/production");
  revalidatePath("/dashboard/production/allocate");
  revalidatePath("/owner/admin");
  if (orderId) revalidatePath(`/dashboard/orders/${orderId}`);
}

export async function saveStagePlanAction(
  orderItemId: string,
  rows: StagePlanInputRow[],
  orderId?: string,
): Promise<SaveStagePlanResult> {
  if (rows.length === 0) {
    return { error: "A schedule needs at least one stage" };
  }

  const { data, error } = await apiCall<StagePlanResponse & { errors?: string[] }>(
    `/api/stage-plan/items/${orderItemId}`,
    { method: "PUT", body: { rows } },
  );

  if (error || !data) {
    return { error: error ?? "Could not save this schedule" };
  }

  revalidatePlanPaths(orderId);
  return {
    error: null,
    plan: data.plan,
    usedDays: data.used_days,
    budgetDays: data.budget_days,
    remainingDays: data.remaining_days,
  };
}

/** "Not now" from the shop floor — pushes the reminder out and lets it fire again. */
export async function snoozeStageAction(
  orderItemId: string,
  stageCode: string,
  hours = 4,
): Promise<{ error: string | null; snoozedUntil?: string | null }> {
  const { data, error } = await apiCall<{ stage: StagePlanRow }>(
    `/api/stage-plan/items/${orderItemId}/stages/${stageCode}/snooze`,
    { method: "POST", body: { hours } },
  );

  if (error || !data) return { error: error ?? "Could not snooze this reminder" };
  revalidatePlanPaths();
  return { error: null, snoozedUntil: data.stage.snoozed_until };
}

/** The admin-level default duration a new item's schedule seeds from. Owner/admin only. */
export async function setStageDefaultDaysAction(
  stageCode: string,
  defaultDays: number | null,
): Promise<{ error: string | null }> {
  const { error } = await apiCall<{ stage: unknown }>(
    `/api/stage-plan/stage-defs/${stageCode}`,
    { method: "PATCH", body: { default_days: defaultDays } },
  );
  if (error) return { error };
  revalidatePlanPaths();
  return { error: null };
}
