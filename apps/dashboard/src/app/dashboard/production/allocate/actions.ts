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
const TIMEOUT_MS = 10_000;

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
