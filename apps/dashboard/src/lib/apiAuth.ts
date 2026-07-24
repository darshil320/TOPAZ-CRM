import { createServerSupabaseClient } from "./supabase/server";

const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";

/**
 * Headers for a FastAPI write call. Sends the pre-shared dashboard key AND the
 * caller's Supabase access token (Bearer) so the API can verify WHO is calling
 * and derive their role/assignment server-side — identity is never trusted from
 * the request body (security-review HIGH-3/HIGH-4). Server-only (reads cookies).
 */
export async function apiHeaders(json = false): Promise<Record<string, string>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = { "API-Key": DASHBOARD_API_KEY };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}
