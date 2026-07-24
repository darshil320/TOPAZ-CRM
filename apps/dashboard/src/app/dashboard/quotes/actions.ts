"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { QuotePayload } from "./types";

// Reads go straight to Supabase under RLS; only side-effecting writes route
// through FastAPI, authenticated with the pre-shared key (§19-G — the key never
// reaches the browser). Same pattern + 10s timeout as customers/[id]/actions.ts.
const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const QUOTES_API = `${API_BASE}/api/quotations`;
const TIMEOUT_MS = 10_000;

export type QuoteResult = { error: string | null; id?: string };

/** Pull the FastAPI error `detail` out of a non-2xx response, if present. */
async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "string") return body.detail;
  } catch {
    // non-JSON body — fall through to the generic message
  }
  return `Request failed (${resp.status})`;
}

/**
 * Boundary validation mirroring the server's Pydantic rules, so the user gets an
 * actionable message before a round-trip. The server re-validates and is the
 * source of truth; this never computes or trusts money.
 */
function validatePayload(payload: QuotePayload): string | null {
  if (!payload.customer_id) return "Select a customer first";
  if (payload.items.length === 0) return "Add at least one line item";
  for (const [i, it] of payload.items.entries()) {
    const n = i + 1;
    if (!it.description.trim()) return `Line ${n}: description is required`;
    if (!it.hsn.trim()) return `Line ${n}: HSN code is required`;
    if (!(Number(it.qty) > 0)) return `Line ${n}: quantity must be greater than 0`;
    if (!(Number(it.unit_price) >= 0)) return `Line ${n}: price must be 0 or more`;
    const rate = Number(it.gst_rate);
    if (!(rate >= 0 && rate <= 100)) return `Line ${n}: GST rate must be between 0 and 100`;
  }
  if (Number(payload.discount || "0") < 0) return "Discount cannot be negative";
  return null;
}

/** Resolve the signed-in user's active salesperson id, or null. */
async function currentSalespersonId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("salespersons")
    .select("id")
    .eq("auth_uid", user.id)
    .eq("active", true)
    .single();
  return data?.id ?? null;
}

export async function createQuote(payload: QuotePayload): Promise<QuoteResult> {
  if (!DASHBOARD_API_KEY) return { error: "Quotations API not configured — set DASHBOARD_API_KEY" };
  const invalid = validatePayload(payload);
  if (invalid) return { error: invalid };

  try {
    const createdBy = await currentSalespersonId();
    if (!createdBy) return { error: "Not authenticated" };

    const resp = await fetch(QUOTES_API, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "API-Key": DASHBOARD_API_KEY },
      body: JSON.stringify({
        customer_id: payload.customer_id,
        items: payload.items,
        discount: payload.discount || "0",
        place_of_supply: payload.place_of_supply || "GJ",
        valid_until: payload.valid_until,
        terms: payload.terms,
        notes: payload.notes,
        created_by: createdBy,
      }),
    });
    if (!resp.ok) return { error: await readError(resp) };

    const quote = await resp.json();
    revalidatePath("/dashboard/quotes");
    return { error: null, id: quote.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function updateQuote(id: string, payload: QuotePayload): Promise<QuoteResult> {
  if (!DASHBOARD_API_KEY) return { error: "Quotations API not configured — set DASHBOARD_API_KEY" };
  const invalid = validatePayload(payload);
  if (invalid) return { error: invalid };

  try {
    // QuoteUpdate accepts only these fields — customer + created_by are fixed
    // for the life of a quotation and are not re-sent on edit.
    const resp = await fetch(`${QUOTES_API}/${id}`, {
      method: "PUT",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "API-Key": DASHBOARD_API_KEY },
      body: JSON.stringify({
        items: payload.items,
        discount: payload.discount || "0",
        place_of_supply: payload.place_of_supply || "GJ",
        valid_until: payload.valid_until,
        terms: payload.terms,
        notes: payload.notes,
      }),
    });
    if (!resp.ok) return { error: await readError(resp) };

    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${id}`);
    return { error: null, id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function reviseQuote(id: string): Promise<QuoteResult> {
  if (!DASHBOARD_API_KEY) return { error: "Quotations API not configured — set DASHBOARD_API_KEY" };
  try {
    const resp = await fetch(`${QUOTES_API}/${id}/revise`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "API-Key": DASHBOARD_API_KEY },
    });
    if (!resp.ok) return { error: await readError(resp) };

    const revision = await resp.json();
    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${id}`);
    return { error: null, id: revision.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function sendQuote(id: string): Promise<QuoteResult> {
  if (!DASHBOARD_API_KEY) return { error: "Quotations API not configured — set DASHBOARD_API_KEY" };
  try {
    const resp = await fetch(`${QUOTES_API}/${id}/send`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "API-Key": DASHBOARD_API_KEY },
    });
    // 202 Accepted: render + WhatsApp send happen in the worker; 409 if not a draft.
    if (!resp.ok) return { error: await readError(resp) };

    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${id}`);
    return { error: null, id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function deleteQuote(id: string): Promise<{ error: string | null }> {
  if (!DASHBOARD_API_KEY) return { error: "Quotations API not configured — set DASHBOARD_API_KEY" };
  try {
    const resp = await fetch(`${QUOTES_API}/${id}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "API-Key": DASHBOARD_API_KEY },
    });
    // 204 No Content on success; 409 when the quotation is no longer a draft.
    if (!resp.ok) return { error: await readError(resp) };

    revalidatePath("/dashboard/quotes");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
