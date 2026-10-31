/**
 * POST /dashboard/products/stickers — the QR sticker PDF, streamed back to the tab
 * StickerPrintForm opened.
 *
 * The API renders in its Celery worker (headless Chromium must never run in the 1GB
 * api container), so this handler queues the job, polls until the worker has stored
 * the PDF, then streams it back on our own origin — the person who tapped "Print"
 * just sees the PDF open. Typical wait: a second or two.
 *
 * Server-to-server, carrying the caller's own session (lib/apiAuth), so the API decides
 * who may print (owner/admin). Validates the form at the boundary so the operator sees
 * what to fix rather than a bare 422.
 *
 * CSRF: the session cookies are SameSite=Lax (not sent on a cross-site POST) and the
 * Origin header must match this host as well.
 */
import { NextResponse, type NextRequest } from "next/server";
import { apiHeaders } from "@/lib/apiAuth";
import { isUuid } from "@/lib/search";

export const maxDuration = 60;

const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const CALL_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 700;
const POLL_DEADLINE_MS = 45_000;
const MAX_IDS = 300;
const MAX_COPIES = 20;
const SIZES = new Set(["small", "medium", "large"]);
const LAYOUTS = new Set(["sheet", "roll"]);

function textError(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function apiDetail(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail) && typeof body.detail[0]?.msg === "string") return body.detail[0].msg;
  } catch {
    // non-JSON
  }
  return `Could not generate the stickers (${resp.status}).`;
}

async function api(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: init.method,
    cache: "no-store",
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: await apiHeaders(init.body !== undefined),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Poll until the worker has stored the PDF. Null on deadline. */
async function waitForPdf(jobId: string): Promise<{ url: string; filename: string } | Response | null> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const resp = await api(`/api/products/stickers/${jobId}`, { method: "GET" });
    if (resp.ok) return (await resp.json()) as { url: string; filename: string };
    if (resp.status !== 404) return textError(await apiDetail(resp), resp.status);
  }
  return null;
}

function parseForm(form: FormData): { body: Record<string, unknown> } | { error: string } {
  const ids = Array.from(new Set(form.getAll("id").map(String))).filter(isUuid);
  const size = String(form.get("size") ?? "small");
  const layout = String(form.get("layout") ?? "sheet");
  const copies = Number(form.get("copies") ?? 1);
  if (ids.length === 0) return { error: "Select at least one product to print." };
  if (ids.length > MAX_IDS) return { error: `Print at most ${MAX_IDS} products at a time.` };
  if (!SIZES.has(size) || !LAYOUTS.has(layout)) return { error: "Unknown sticker size or paper." };
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
    return { error: `Copies must be a whole number from 1 to ${MAX_COPIES}.` };
  }
  return { body: { product_ids: ids, size, layout, copies } };
}

/** No Origin header (some same-origin form posts) passes; anything else must match.
 *  "null" (sandboxed/opaque origins) and unparsable values are refused. */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return textError("Cross-site request refused.", 403);
  const parsed = parseForm(await request.formData());
  if ("error" in parsed) return textError(parsed.error, 400);

  try {
    const queued = await api("/api/products/stickers", { method: "POST", body: parsed.body });
    if (!queued.ok) return textError(await apiDetail(queued), queued.status);
    const { job_id: jobId } = (await queued.json()) as { job_id: string };

    const ready = await waitForPdf(jobId);
    if (ready === null) {
      return textError("The sticker PDF is taking longer than usual — close this tab and print again.", 504);
    }
    if (ready instanceof Response) return ready;

    const pdf = await fetch(ready.url, { cache: "no-store", signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    if (!pdf.ok || !pdf.body) return textError("The sticker PDF could not be downloaded — try again.", 502);
    return new NextResponse(pdf.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${ready.filename.replace(/[^\w.-]/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("sticker PDF request failed", err);
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return textError(
      timedOut ? "The sticker service did not respond — try again." : "The sticker service is unreachable — try again.",
      504,
    );
  }
}
