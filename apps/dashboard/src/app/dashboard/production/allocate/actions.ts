"use server";

/**
 * Allocation write path. Reads on this route go direct to Supabase under RLS
 * (§19-G house pattern); the write goes through FastAPI because the allocation
 * invariant — at most one active assignment per item — is enforced there with a
 * row lock plus a partial unique index, not by anything RLS can express.
 */

import { revalidatePath } from "next/cache";
import { apiHeaders } from "@/lib/apiAuth";

const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const PRODUCTION_API = `${API_BASE}/api/production`;
const TIMEOUT_MS = 30_000;

export interface AllocateResult {
  error: string | null;
  assignmentId?: string;
  currentStage?: string | null;
  previousWorkshopId?: string | null;
}

/** The API's `detail` is written for the operator — surface it verbatim. */
async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "string") return body.detail;
    // 422 from FastAPI's own validation is a list of field errors.
    if (body && Array.isArray(body.detail) && body.detail.length > 0) {
      const first = body.detail[0];
      if (first && typeof first.msg === "string") return first.msg;
    }
  } catch {
    // non-JSON
  }
  return `Request failed (${resp.status})`;
}

export async function allocateItem(
  orderItemId: string,
  workshopId: string,
  dueDate?: string | null,
): Promise<AllocateResult> {
  if (!DASHBOARD_API_KEY) {
    return { error: "Production API not configured — set DASHBOARD_API_KEY" };
  }
  if (!orderItemId) return { error: "Pick the item to allocate" };
  if (!workshopId) return { error: "Pick a workshop first" };

  try {
    const resp = await fetch(`${PRODUCTION_API}/allocate`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(true),
      body: JSON.stringify({
        order_item_id: orderItemId,
        workshop_id: workshopId,
        due_date: dueDate || null,
      }),
    });
    if (!resp.ok) return { error: await readError(resp) };

    const body = await resp.json();
    revalidatePath("/dashboard/production/allocate");
    revalidatePath("/dashboard/orders");
    revalidatePath("/owner/admin");
    return {
      error: null,
      assignmentId: body.assignment_id as string,
      currentStage: (body.current_stage ?? null) as string | null,
      previousWorkshopId: (body.previous_workshop_id ?? null) as string | null,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { error: "The production service did not respond in time — refresh and check before retrying." };
    }
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

/**
 * Plan a MULTI-WORKSHOP route for one item (module 14) — the richer sibling of
 * `allocateItem` above.
 *
 * Where allocate says "this item goes to one workshop", a route says "polishing here
 * for 5 days, then finishing there for 4". The API activates leg 1 through the same
 * allocate path, so the one-active-assignment invariant is untouched; the difference is
 * that legs 2..n exist as a plan, each with its own deadline, and finishing a leg's last
 * stage auto-opens a consignment to the next workshop.
 *
 * `legs` and `templateId` are mutually exclusive — the API refuses both, rather than
 * silently preferring one.
 */
export interface RouteLegInput {
  workshop_id: string;
  stage_from: string;
  stage_to: string;
  planned_days: number | null;
}

export interface PlanRouteResult {
  error: string | null;
  legCount?: number;
  activatedWorkshopId?: string;
  firstDueAt?: string | null;
}

export async function planRoute(
  orderItemId: string,
  input: { legs?: RouteLegInput[]; templateId?: string; startAt?: string | null },
): Promise<PlanRouteResult> {
  if (!DASHBOARD_API_KEY) {
    return { error: "Production API not configured — set DASHBOARD_API_KEY" };
  }
  if (!orderItemId) return { error: "Pick the item to route" };
  if (!input.legs?.length && !input.templateId) {
    return { error: "Add at least one leg, or pick a saved route" };
  }

  try {
    const resp = await fetch(`${API_BASE}/api/routing/items/${orderItemId}/route`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(true),
      body: JSON.stringify({
        legs: input.templateId ? null : input.legs,
        template_id: input.templateId ?? null,
        start_at: input.startAt || null,
      }),
    });
    if (!resp.ok) return { error: await readError(resp) };

    const body = await resp.json();
    revalidatePath("/dashboard/production/allocate");
    revalidatePath("/dashboard/production");
    revalidatePath("/dashboard/orders");
    revalidatePath("/workshop");
    return {
      error: null,
      legCount: Array.isArray(body.legs) ? body.legs.length : 0,
      activatedWorkshopId: body.assignment?.workshop_id ?? undefined,
      firstDueAt: body.assignment?.due_at ?? null,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return {
        error: "The production service did not respond in time — refresh and check before retrying.",
      };
    }
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
