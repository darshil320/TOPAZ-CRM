/**
 * Workshop reads, server-side only.
 *
 * WHY THIS IS NOT A DIRECT SUPABASE QUERY (the house read pattern elsewhere):
 * the allocate modal and the admin tab both need `open_item_count`, an aggregate
 * over `order_item_assignments`. That table's RLS (`oia_select`, 0024) scopes a
 * salesperson to their own customers' assignments, so a client-side count would be
 * silently WRONG — it would under-report every other salesperson's load, which is
 * exactly the number the operator is choosing on. `GET /api/workshops` computes it
 * service-side; its docstring says the endpoint exists for this reason.
 */

import { apiHeaders } from "@/lib/apiAuth";

const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const WORKSHOPS_API = `${API_BASE}/api/workshops`;
const TIMEOUT_MS = 30_000;

export interface WorkshopRow {
  id: string;
  name: string;
  type: string;
  manager_name: string | null;
  manager_phone: string | null;
  manager_salesperson_id: string | null;
  address: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  open_item_count: number;
}

export interface WorkshopListResult {
  workshops: WorkshopRow[];
  error: string | null;
}

/**
 * Every workshop (`activeOnly = false`) or only the active ones. Never throws —
 * callers render a banner off `error` and degrade to a read-only view.
 */
export async function listWorkshops(activeOnly = false): Promise<WorkshopListResult> {
  if (!DASHBOARD_API_KEY) {
    return { workshops: [], error: "Workshops API not configured — set DASHBOARD_API_KEY" };
  }
  try {
    const resp = await fetch(`${WORKSHOPS_API}?active=${activeOnly ? "true" : "false"}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (!resp.ok) {
      let detail = `Request failed (${resp.status})`;
      try {
        const body = await resp.json();
        if (body && typeof body.detail === "string") detail = body.detail;
      } catch {
        // non-JSON
      }
      return { workshops: [], error: `Could not load workshops — ${detail}` };
    }
    const body = await resp.json();
    const workshops = Array.isArray(body?.workshops) ? (body.workshops as WorkshopRow[]) : [];
    return { workshops, error: null };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "the production service did not respond in time"
        : err instanceof Error
          ? err.message
          : "server error";
    return { workshops: [], error: `Could not load workshops — ${reason}. Refresh to retry.` };
  }
}
