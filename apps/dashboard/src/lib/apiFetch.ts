/**
 * One typed FastAPI call, server-side only.
 *
 * Every module-14 read/write goes through here instead of hand-rolling fetch in each
 * lib file, because three things must be identical on all of them and were not before:
 *
 *   1. the API key + the caller's Supabase access token (lib/apiAuth), so the API can
 *      derive WHO is calling and never trust an id from the body;
 *   2. a real timeout — a hung production API must not hang a manager's phone;
 *   3. the FastAPI `detail` string surfaced as `error`. A generic "request failed" is
 *      useless on a shop floor: the API's messages are written to be read by the person
 *      who tapped the button ("This item is in transit — receive it first").
 *
 * Never throws. Callers render `error` and degrade to read-only.
 */

import { apiHeaders } from "@/lib/apiAuth";

const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const TIMEOUT_MS = 20_000;

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

export async function apiCall<T>(
  path: string,
  init?: { method?: "GET" | "POST" | "PATCH"; body?: unknown },
): Promise<ApiResult<T>> {
  if (!DASHBOARD_API_KEY) {
    return { data: null, error: "Production API not configured — set DASHBOARD_API_KEY" };
  }

  const method = init?.method ?? "GET";
  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(init?.body !== undefined),
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (!resp.ok) {
      let detail = `Request failed (${resp.status})`;
      try {
        const body = await resp.json();
        if (typeof body?.detail === "string") {
          detail = body.detail;
        } else if (Array.isArray(body?.detail) && body.detail.length > 0) {
          // FastAPI validation errors arrive as a list of {loc, msg}. Show the first
          // message rather than "[object Object]".
          detail = body.detail[0]?.msg ?? detail;
        }
      } catch {
        // non-JSON body — keep the status line
      }
      return { data: null, error: detail };
    }

    return { data: (await resp.json()) as T, error: null };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "the production service did not respond in time"
        : err instanceof Error
          ? err.message
          : "server error";
    return { data: null, error: `${reason}. Please retry.` };
  }
}
