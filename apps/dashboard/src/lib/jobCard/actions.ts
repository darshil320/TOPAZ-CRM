"use server";

/**
 * Job card server actions — the money-free spec sheet (`apps/api/src/api/job_cards.py`).
 *
 * A job card is the visual companion to a quotation and the workshop's production
 * sheet: client, dates, salesperson, then per item its size, photo, product and
 * detail block. It carries NO prices, which is what makes the identical PDF safe
 * to send to both a customer and an outside vendor workshop.
 *
 * Rendering runs in Celery (Playwright is slow), so create/send return `queued`
 * and the PDF appears a few seconds later — same contract as quotation PDFs.
 */

import { revalidatePath } from "next/cache";
import { apiHeaders } from "@/lib/apiAuth";

const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const JOB_CARD_API = `${API_BASE}/api/job-cards`;
const TIMEOUT_MS = 30_000;

const NOT_CONFIGURED = "Job cards are not configured — set DASHBOARD_API_KEY on the dashboard.";

export type JobCardSource = "quotation" | "order";
export type JobCardRecipient = "customer" | "workshop";

export interface JobCardResult {
  error: string | null;
  queued?: boolean;
  url?: string;
}

/** The API's `detail` is written for the operator — surface it verbatim. */
async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "string") return body.detail;
    if (body && Array.isArray(body.detail) && body.detail.length > 0) {
      const first = body.detail[0];
      if (first && typeof first.msg === "string") return first.msg;
    }
  } catch {
    // non-JSON body — fall through to the status line
  }
  return `Request failed (${resp.status})`;
}

function networkMessage(err: unknown): string {
  if (err instanceof Error && err.name === "TimeoutError") {
    return "The job card service did not respond in time — check your connection and retry.";
  }
  return err instanceof Error ? err.message : "Server error — retry in a moment.";
}

function pathFor(source: JobCardSource, entityId: string): string {
  return source === "quotation" ? `/dashboard/quotes/${entityId}` : `/dashboard/orders/${entityId}`;
}

/** Queue a render. Safe to call again — it re-renders and files a new version. */
export async function createJobCard(
  source: JobCardSource,
  entityId: string,
): Promise<JobCardResult> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };
  if (!entityId) return { error: "Missing the record to build a job card from." };

  try {
    const resp = await fetch(`${JOB_CARD_API}/${source}/${entityId}`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(true),
    });
    if (!resp.ok) return { error: await readError(resp) };
    revalidatePath(pathFor(source, entityId));
    return { error: null, queued: true };
  } catch (err) {
    return { error: networkMessage(err) };
  }
}

/**
 * Queue a send. Renders first if no job card exists yet.
 *
 * `workshop` is order-only and needs at least one allocated item — the API returns
 * a 409 naming that, which we surface rather than translate.
 */
export async function sendJobCard(
  source: JobCardSource,
  entityId: string,
  to: JobCardRecipient,
): Promise<JobCardResult> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };
  if (!entityId) return { error: "Missing the record to send." };
  if (to === "workshop" && source !== "order") {
    return { error: "Workshop job cards come from an order — a quotation has no allocation yet." };
  }

  try {
    const resp = await fetch(`${JOB_CARD_API}/${source}/${entityId}/send`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(true),
      body: JSON.stringify({ to }),
    });
    if (!resp.ok) return { error: await readError(resp) };
    revalidatePath(pathFor(source, entityId));
    return { error: null, queued: true };
  } catch (err) {
    return { error: networkMessage(err) };
  }
}

export interface JobCardPage {
  url: string;
  filename: string;
}

export interface JobCardShareResult {
  error: string | null;
  pages?: JobCardPage[];
  totalPages?: number;
  format?: "image" | "pdf";
  expiresIn?: number;
}

/**
 * Signed links to EVERY page of the latest job card, for sharing with anyone.
 *
 * Distinct from `getJobCardUrl`, which returns one page and lasts an hour: a share
 * goes to somebody outside the business (a designer, a carpenter, the customer's
 * family) who is not logged in and will not open it immediately. The API signs all
 * pages for 7 days and records the share in the audit log.
 *
 * Not a WhatsApp send: the Cloud API only permits free-form media to someone inside
 * an open 24-hour service window, which an arbitrary third party is not — see the
 * Share button in components/JobCardActions.tsx.
 */
export async function getJobCardShare(
  source: JobCardSource,
  entityId: string,
): Promise<JobCardShareResult> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };

  try {
    const resp = await fetch(`${JOB_CARD_API}/${source}/${entityId}/share`, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (resp.status === 404) return { error: "No job card yet — generate one first." };
    if (!resp.ok) return { error: await readError(resp) };
    const body = (await resp.json()) as {
      pages: JobCardPage[];
      total_pages: number;
      format: "image" | "pdf";
      expires_in: number;
    };
    return {
      error: null,
      pages: body.pages,
      totalPages: body.total_pages,
      format: body.format,
      expiresIn: body.expires_in,
    };
  } catch (err) {
    return { error: networkMessage(err) };
  }
}

/** Short-lived signed link to the latest rendered job card. 404 until one exists. */
export async function getJobCardUrl(
  source: JobCardSource,
  entityId: string,
): Promise<JobCardResult> {
  if (!DASHBOARD_API_KEY) return { error: NOT_CONFIGURED };

  try {
    const resp = await fetch(`${JOB_CARD_API}/${source}/${entityId}/url`, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (resp.status === 404) {
      return { error: "No job card yet — generate one first." };
    }
    if (!resp.ok) return { error: await readError(resp) };
    const body = (await resp.json()) as { url: string };
    return { error: null, url: body.url };
  } catch (err) {
    return { error: networkMessage(err) };
  }
}
