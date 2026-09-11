"use server";

/**
 * Lead call-recording server actions — thin, typed wrappers around
 * `apps/api/src/api/lead_recordings.py`.
 *
 * Own file, not folded into `leads/actions.ts`: that file owns lead CRUD/status
 * (plain JSON in/out); this one owns a signed-upload lifecycle (sign → PUT →
 * complete), the same split `leads/actions.ts` vs `lib/media/actions.ts` already
 * uses for photos. Same 15s timeout / apiHeaders() / readError() shape as
 * `leads/actions.ts` — these are small JSON bodies, not large-file transfer, so
 * there is no reason to borrow `lib/media/actions.ts`'s longer 30s timeout.
 */

import { apiHeaders } from "@/lib/apiAuth";

const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const TIMEOUT_MS = 15_000;

const NOT_CONFIGURED = "Leads API not configured — set DASHBOARD_API_KEY";

/** Mime types the API allows (`services/lead_audio.MIME_EXTENSIONS`). */
export type LeadAudioMime = "audio/webm" | "audio/mp4" | "audio/mpeg" | "audio/ogg" | "audio/wav";

export interface SignLeadAudioResult {
  recording_id: string;
  storage_key: string;
  upload_url: string;
  expires_in: number;
  max_bytes: number;
}

export interface LeadRecording {
  id: string;
  note: string | null;
  duration_seconds: number | null;
  bytes: number | null;
  created_at: string;
  created_by: string | null;
  uploaded_by_name: string | null;
  url: string;
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

function recordingsUrl(leadId: string, path = ""): string {
  return `${API_BASE}/api/leads/${leadId}/recordings${path}`;
}

export async function signLeadAudioUpload(
  leadId: string,
  mime: LeadAudioMime,
  note?: string,
): Promise<{ error: string | null; data?: SignLeadAudioResult }> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };
  try {
    const resp = await fetch(recordingsUrl(leadId, "/sign-upload"), {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...(await apiHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ mime, note: note && note.trim() ? note.trim() : undefined }),
    });
    if (!resp.ok) return { error: await readError(resp) };
    const data = (await resp.json()) as SignLeadAudioResult;
    return { error: null, data };
  } catch {
    return { error: "Could not reach the leads service. Check your connection and try again." };
  }
}

export async function completeLeadAudioUpload(
  leadId: string,
  recordingId: string,
  bytes: number,
): Promise<{ error: string | null }> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };
  try {
    const resp = await fetch(recordingsUrl(leadId, `/${recordingId}/complete`), {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...(await apiHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ bytes }),
    });
    if (!resp.ok) return { error: await readError(resp) };
    return { error: null };
  } catch {
    return { error: "Could not reach the leads service. Check your connection and try again." };
  }
}

export async function listLeadRecordings(
  leadId: string,
): Promise<{ error: string | null; data?: LeadRecording[] }> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };
  try {
    const resp = await fetch(recordingsUrl(leadId), {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
      cache: "no-store",
    });
    if (!resp.ok) return { error: await readError(resp) };
    const body = (await resp.json()) as { recordings: LeadRecording[] };
    return { error: null, data: body.recordings };
  } catch {
    return { error: "Could not reach the leads service. Check your connection and try again." };
  }
}
