"use server";

/**
 * Customer approve / request-changes, routed through the Next server.
 *
 * It used to be a fetch from the CUSTOMER'S BROWSER straight to the FastAPI
 * host, and that could not work in production for two independent reasons:
 *
 *  1. the API sets no CORS headers, so even a request that reaches the server
 *     has its response blocked from JavaScript — fetch() rejects and the page
 *     shows "Network error. Please try again.";
 *  2. the browser was handed `NEXT_PUBLIC_API_URL ?? TOPAZ_API_URL`, and when
 *     neither is set in the browser's environment that resolves to
 *     `http://localhost:8000` — a request to the customer's own phone, blocked
 *     as mixed content before it leaves the device.
 *
 * Same-origin server action removes both: the browser POSTs to the page's own
 * origin, and the API call happens server-to-server where the key, the internal
 * URL and the timeout already live. The approval token remains the capability —
 * this endpoint is unauthenticated by design, exactly as the API's is.
 */

const SERVER_API = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 20_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DecisionResult {
  error: string | null;
  status?: string;
}

export async function decideQuoteAction(
  token: string,
  approve: boolean,
): Promise<DecisionResult> {
  if (!UUID_RE.test(token)) {
    return { error: "This approval link is not valid. Please contact the showroom." };
  }

  try {
    const resp = await fetch(
      `${SERVER_API}/api/public/quotes/${token}/${approve ? "approve" : "reject"}`,
      { method: "POST", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    if (resp.status === 404) {
      return { error: "This quotation link has expired. Please contact the showroom." };
    }
    if (!resp.ok) {
      return { error: "Something went wrong. Please try again or contact the showroom." };
    }

    const body = (await resp.json()) as { status?: string };
    return { error: null, status: body.status ?? (approve ? "approved" : "rejected") };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      error: timedOut
        ? "The showroom's system did not respond in time. Please try again."
        : "Could not reach the showroom's system. Please try again in a moment.",
    };
  }
}
