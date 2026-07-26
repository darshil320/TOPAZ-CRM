"use server";

/**
 * Media server actions — thin, typed wrappers around the frozen FastAPI media
 * contract (`apps/api/src/api/media.py`).
 *
 * Why server actions and not a direct browser fetch: signing an upload needs the
 * pre-shared `DASHBOARD_API_KEY`, which must never reach a browser bundle. The
 * browser only ever sees the short-lived signed Storage URL these actions hand back.
 *
 * Every call carries a 10s AbortSignal.timeout and returns a discriminated
 * `{ error }` result rather than throwing — the upload widget turns `error` into a
 * retryable, human-readable message and never loses the user's tap.
 */

import { apiHeaders } from "@/lib/apiAuth";

const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const MEDIA_API = `${API_BASE}/api/media`;
const TIMEOUT_MS = 10_000;

const NOT_CONFIGURED = "Photo uploads are not configured — set DASHBOARD_API_KEY on the dashboard.";

/** Entity types the API will accept (`services/media_entities.ENTITY_TABLES`). */
export type MediaEntityType = "customer" | "order" | "order_item" | "production_event";

/** Media kinds (`media.kind` CHECK constraint). */
export type MediaKind = "reference" | "drawing" | "site" | "production" | "finished" | "delivery";

/** Mime types the API allows (`services/media_entities.MIME_EXTENSIONS`). */
export type MediaMime = "image/jpeg" | "image/png" | "image/webp";

export interface SignUploadResult {
  media_id: string;
  storage_key: string;
  upload_url: string;
  expires_in: number;
  max_bytes: number;
}

export interface CompleteUploadResult {
  id: string;
  status: string;
  thumb_pending: boolean;
}

export interface MediaUrlResult {
  url: string;
  is_thumb: boolean;
}

export type ActionResult<T> = { error: string | null; data?: T };

/** Surface the API's own `detail` verbatim — those messages say what to do next. */
async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "string") return body.detail;
  } catch {
    // non-JSON body — fall through to the status line
  }
  return `Request failed (${resp.status})`;
}

function networkMessage(err: unknown): string {
  if (err instanceof Error && err.name === "TimeoutError") {
    return "The photo service did not respond in time — check your connection and retry.";
  }
  return err instanceof Error ? err.message : "Server error — retry in a moment.";
}

/**
 * Reserve a media row and mint a signed Storage upload URL.
 * The caller PUTs the bytes to `upload_url`, then calls `completeUpload`.
 */
export async function signUpload(input: {
  entityType: MediaEntityType;
  entityId: string;
  kind: MediaKind;
  mime: MediaMime;
}): Promise<ActionResult<SignUploadResult>> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };
  if (!input.entityId) return { error: "Missing the record this photo belongs to." };

  try {
    const resp = await fetch(`${MEDIA_API}/sign-upload`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(true),
      body: JSON.stringify({
        entity_type: input.entityType,
        entity_id: input.entityId,
        kind: input.kind,
        mime: input.mime,
      }),
    });
    if (!resp.ok) return { error: await readError(resp) };
    return { error: null, data: (await resp.json()) as SignUploadResult };
  } catch (err) {
    return { error: networkMessage(err) };
  }
}

/**
 * Confirm the bytes landed. Idempotent server-side: a repeat call on an already
 * ready row returns 200, so a retry after a flaky network is always safe.
 */
export async function completeUpload(
  mediaId: string,
  bytes: number,
): Promise<ActionResult<CompleteUploadResult>> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { error: "The file appears to be empty — pick or retake the photo." };
  }

  try {
    const resp = await fetch(`${MEDIA_API}/${mediaId}/complete`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(true),
      body: JSON.stringify({ bytes: Math.round(bytes) }),
    });
    if (!resp.ok) return { error: await readError(resp) };
    return { error: null, data: (await resp.json()) as CompleteUploadResult };
  } catch (err) {
    return { error: networkMessage(err) };
  }
}

/**
 * Short-lived signed READ url. `thumb` asks for the thumbnail; the API already
 * falls back to the full image when `thumb_key` is still NULL, and `is_thumb`
 * reports which one came back.
 */
export async function getMediaUrl(
  mediaId: string,
  thumb = true,
): Promise<ActionResult<MediaUrlResult>> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };

  try {
    const resp = await fetch(`${MEDIA_API}/${mediaId}/url?thumb=${thumb ? "true" : "false"}`, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (!resp.ok) return { error: await readError(resp) };
    return { error: null, data: (await resp.json()) as MediaUrlResult };
  } catch (err) {
    return { error: networkMessage(err) };
  }
}
