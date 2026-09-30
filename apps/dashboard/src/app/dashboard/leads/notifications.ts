"use server";

/**
 * Follow-up notification server actions — thin wrappers around
 * apps/api/src/api/lead_followup_notifications.py, same shape as
 * leads/actions.ts (apiHeaders(), AbortSignal.timeout(15000), readError()).
 *
 * listNotifications is called directly from a client component (the bell) —
 * server actions used for a GET-shaped list fetch, not only mutations, is
 * already this app's own pattern (see LeadAudioRecordings.tsx calling
 * listLeadRecordings). No revalidatePath anywhere here: this data isn't read
 * via a server-rendered page, the bell refetches client-side after a mutation.
 */

import { apiHeaders } from "@/lib/apiAuth";

const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const NOTIFICATIONS_API = `${API_BASE}/api/leads/notifications`;
const TIMEOUT_MS = 15_000;

const NOT_CONFIGURED = "Leads API not configured — set DASHBOARD_API_KEY";

export interface LeadFollowUpNotification {
  id: string;
  lead_id: string;
  due_on: string;
  created_at: string;
  cleared_at: string | null;
  lead_name: string | null;
  lead_phone: string;
  lead_status: string;
}

async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "string") return body.detail;
  } catch {
    // non-JSON
  }
  return `Request failed (${resp.status})`;
}

export async function listNotifications(): Promise<{
  error: string | null;
  notifications?: LeadFollowUpNotification[];
  unreadCount?: number;
}> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };
  try {
    const resp = await fetch(NOTIFICATIONS_API, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
      cache: "no-store",
    });
    if (!resp.ok) return { error: await readError(resp) };
    const body = await resp.json();
    return { error: null, notifications: body.notifications, unreadCount: body.unread_count };
  } catch {
    return { error: "Could not reach the leads service. Check your connection and try again." };
  }
}

export async function clearNotification(id: string): Promise<{ error: string | null }> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };
  try {
    const resp = await fetch(`${NOTIFICATIONS_API}/${id}/clear`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (!resp.ok) return { error: await readError(resp) };
    return { error: null };
  } catch {
    return { error: "Could not reach the leads service. Check your connection and try again." };
  }
}

export async function clearAllNotifications(): Promise<{ error: string | null; cleared?: number }> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };
  try {
    const resp = await fetch(`${NOTIFICATIONS_API}/clear-all`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (!resp.ok) return { error: await readError(resp) };
    const body = await resp.json();
    return { error: null, cleared: body.cleared };
  } catch {
    return { error: "Could not reach the leads service. Check your connection and try again." };
  }
}
