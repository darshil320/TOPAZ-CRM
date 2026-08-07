"use server";

import { revalidatePath } from "next/cache";
import { apiHeaders } from "@/lib/apiAuth";

// Order writes route through FastAPI (§19-G); reads go direct to Supabase (RLS).
const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const ORDERS_API = `${API_BASE}/api/orders`;
// Order-from-quote copies quote header + all line items; on a cold API instance
// this can exceed a tight 10s budget. A client abort here used to leave the
// server to finish anyway, and (pre-idempotency) each retry created a duplicate
// order — so give the request real headroom.
const TIMEOUT_MS = 30_000;

type Result = { error: string | null; id?: string };

async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "string") return body.detail;
  } catch {
    // non-JSON
  }
  return `Request failed (${resp.status})`;
}

export async function createOrderFromQuote(quotationId: string): Promise<Result> {
  if (!DASHBOARD_API_KEY) return { error: "Orders API not configured — set DASHBOARD_API_KEY" };
  try {
    const resp = await fetch(`${ORDERS_API}/from-quote/${quotationId}`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (!resp.ok) return { error: await readError(resp) };
    const order = await resp.json();
    revalidatePath("/dashboard/orders");
    revalidatePath(`/dashboard/quotes/${quotationId}`);
    return { error: null, id: order.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export interface StatusResult {
  error: string | null;
  /** Set on a cancellation: money already taken that the business now owes back. */
  refundDue?: string;
  /** What the cancel stood down, so the UI can say so rather than just "done". */
  legsCancelled?: number;
  assignmentsClosed?: number;
  stagePlansSkipped?: number;
}

export async function patchOrderStatus(
  orderId: string,
  nextStatus: string,
  reason?: string,
): Promise<StatusResult> {
  if (!DASHBOARD_API_KEY) return { error: "Orders API not configured — set DASHBOARD_API_KEY" };
  try {
    const resp = await fetch(`${ORDERS_API}/${orderId}/status`, {
      method: "PATCH",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(true),
      body: JSON.stringify({ status: nextStatus, reason: reason ?? null }),
    });
    if (!resp.ok) return { error: await readError(resp) };
    const body = (await resp.json().catch(() => ({}))) as {
      refund_due?: string;
      legs_cancelled?: number;
      assignments_closed?: number;
      stage_plans_skipped?: number;
    };
    revalidatePath("/dashboard/orders");
    revalidatePath(`/dashboard/orders/${orderId}`);
    // A cancel also stands down production and unschedules reminders, so the boards
    // that render those are stale too.
    if (nextStatus === "cancelled") {
      revalidatePath("/dashboard/production");
      revalidatePath("/dashboard/production/allocate");
      revalidatePath("/workshop");
    }
    return {
      error: null,
      refundDue: body.refund_due,
      legsCancelled: body.legs_cancelled,
      assignmentsClosed: body.assignments_closed,
      stagePlansSkipped: body.stage_plans_skipped,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export interface CancellationPreview {
  error: string | null;
  cancellable?: boolean;
  statusAllowsCancel?: boolean;
  blockers?: string[];
  refundDue?: string;
  deliveredItems?: number;
  totalItems?: number;
}

/**
 * What cancelling this order would mean — fetched before the confirm dialog.
 *
 * Read-only. The point is that the operator sees the advance already collected, and
 * anything blocking the cancel, BEFORE they commit — not after.
 */
export async function getCancellationPreview(orderId: string): Promise<CancellationPreview> {
  if (!DASHBOARD_API_KEY) return { error: "Orders API not configured — set DASHBOARD_API_KEY" };
  try {
    const resp = await fetch(`${ORDERS_API}/${orderId}/cancellation-preview`, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (!resp.ok) return { error: await readError(resp) };
    const body = (await resp.json()) as {
      cancellable: boolean;
      status_allows_cancel: boolean;
      blockers: string[];
      refund_due: string;
      delivered_items: number;
      total_items: number;
    };
    return {
      error: null,
      cancellable: body.cancellable,
      statusAllowsCancel: body.status_allows_cancel,
      blockers: body.blockers,
      refundDue: body.refund_due,
      deliveredItems: body.delivered_items,
      totalItems: body.total_items,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
