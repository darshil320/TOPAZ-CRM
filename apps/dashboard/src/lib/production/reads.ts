/**
 * Server-side reads for production, routing and transit (module 09/14).
 *
 * WHY NOT DIRECT SUPABASE QUERIES (the house read pattern elsewhere): the audiences.
 * A `workshop_manager` has no `order_items` SELECT policy and must never get one — that
 * table carries unit_price/line_total/gst_rate (0024:118) — and a `delivery` courier has
 * no relationship to the customer at all. Both read production data ONLY through the
 * API's money-blind projections. A client-side query would either return nothing or,
 * worse, need a policy that leaks money to a shop floor.
 *
 * Same reasoning lib/workshops.ts records for `open_item_count`, applied to the whole
 * production surface.
 */

import { apiCall } from "@/lib/apiFetch";
import type {
  MyQueueResponse,
  RouteLeg,
  RouteTemplate,
  StageDef,
  StageDefWithDefault,
  StagePlanResponse,
  TransferLine,
  TransferSummary,
} from "./types";

export async function getMyQueue() {
  return apiCall<MyQueueResponse>("/api/production/my-queue");
}

export interface ItemDetail {
  item: Record<string, unknown> & {
    id: string;
    description: string;
    current_stage: string | null;
    blocked: boolean;
    transit_transfer_id: string | null;
    order_no: string;
    customer_name: string;
    workshop_name: string | null;
    due_at: string | null;
    leg_seq: number | null;
    leg_stage_from: string | null;
    leg_stage_to: string | null;
    leg_due_at: string | null;
  };
  legs: RouteLeg[];
  events: {
    id: string;
    stage_code: string;
    kind: string;
    note: string | null;
    at: string;
    actor_name: string | null;
    thumb_key: string | null;
  }[];
  stages: StageDef[];
  done_stages: string[];
  capabilities: string[];
}

export async function getItemDetail(orderItemId: string) {
  return apiCall<ItemDetail>(`/api/production/items/${orderItemId}`);
}

export async function getItemRoute(orderItemId: string) {
  return apiCall<{ order_item_id: string; legs: RouteLeg[]; stages: StageDef[] }>(
    `/api/routing/items/${orderItemId}/route`,
  );
}

export async function listRouteTemplates(activeOnly = true) {
  return apiCall<{ templates: RouteTemplate[] }>(
    `/api/routing/templates?active=${activeOnly ? "true" : "false"}`,
  );
}

/** The courier's own open runs, items included. The mediator app's home screen. */
export async function getMyRuns() {
  return apiCall<{ transfers: TransferSummary[] }>("/api/transfers/my");
}

export async function getTransfer(transferId: string) {
  return apiCall<{
    transfer: TransferSummary;
    items: TransferLine[];
    events: {
      id: string;
      kind: string;
      note: string | null;
      at: string;
      actor_name: string | null;
      thumb_key: string | null;
    }[];
  }>(`/api/transfers/${transferId}`);
}

export async function listWorkshopTransfers(
  workshopId: string,
  direction?: "in" | "out",
  includeClosed = false,
) {
  const params = new URLSearchParams({ workshop_id: workshopId });
  if (direction) params.set("direction", direction);
  if (includeClosed) params.set("include_closed", "true");
  return apiCall<{ transfers: TransferSummary[] }>(`/api/transfers?${params.toString()}`);
}

/** One item's stage schedule plus its budget arithmetic (0035). */
export async function getStagePlan(orderItemId: string) {
  return apiCall<StagePlanResponse>(`/api/stage-plan/items/${orderItemId}`);
}

/** The 11 stages with their admin-level default durations. */
export async function listStageDefaults() {
  return apiCall<{ stages: StageDefWithDefault[] }>("/api/stage-plan/stage-defs");
}

export async function listWorkshopStaff(workshopId: string, activeOnly = true) {
  return apiCall<{
    staff: {
      id: string;
      salesperson_id: string;
      role: "lead" | "sub";
      active: boolean;
      salesperson_name: string;
      salesperson_whatsapp: string | null;
      salesperson_role: string;
      created_at: string;
    }[];
  }>(`/api/workshops/${workshopId}/staff?active=${activeOnly ? "true" : "false"}`);
}
