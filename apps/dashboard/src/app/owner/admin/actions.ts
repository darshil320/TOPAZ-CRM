"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { apiHeaders } from "@/lib/apiAuth";

// Workshop writes route through FastAPI (not straight to Supabase, even though RLS
// would allow it): the E.164 phone rule with a usable message and the deactivation
// guard ("N item(s) still in production") cannot live in RLS. See api/workshops.py.
const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const WORKSHOPS_API = `${API_BASE}/api/workshops`;
const TIMEOUT_MS = 30_000;
const E164 = /^\+[1-9][0-9]{7,14}$/;

export interface ProductInput {
  name: string;
  category?: string;
  hsn: string;
  gst_rate: string;
  base_price?: string;
  unit?: string;
}

export async function addProduct(input: ProductInput): Promise<{ error: string | null }> {
  if (!input.name.trim()) return { error: "Name is required" };
  const rate = Number(input.gst_rate);
  if (!(rate >= 0 && rate <= 100)) return { error: "GST rate must be 0–100" };
  try {
    const supabase = await createServerSupabaseClient();
    // RLS products_insert is owner/admin only — a non-admin fails here too.
    const { error } = await supabase.from("products").insert({
      name: input.name.trim(),
      category: input.category?.trim() || null,
      hsn: input.hsn.trim() || "9403",
      gst_rate: rate,
      base_price: input.base_price ? Number(input.base_price) : null,
      unit: input.unit?.trim() || "nos",
    });
    if (error) return { error: error.message };
    revalidatePath("/owner/admin");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

/**
 * Point a product at its CATALOG photo (migration 0027).
 *
 * This is what makes the photo reusable: every quote and order line referencing
 * the product inherits it on the job card, so the same sofa is never re-uploaded.
 * A line can still override with its own photo, which always wins.
 *
 * The media row itself is created by MediaUpload through the FastAPI media route;
 * this only records which one is primary, and `products` RLS already restricts
 * that write to owner/admin.
 */
export async function setProductPrimaryPhoto(
  id: string,
  mediaId: string | null,
): Promise<{ error: string | null }> {
  try {
    const supabase = await createServerSupabaseClient();

    // Server Actions are callable RPC, not just whatever the UI sends — so verify
    // the media row really is THIS product's catalog photo before pointing at it.
    // `primary_media_id` is a bare FK to media(id): without this check a caller
    // could aim it at a customer's 'site' photo (a home interior), which the job
    // card would then inline and WhatsApp to an outside vendor workshop.
    // job_card_repo enforces the same triple at read time; both layers matter.
    if (mediaId) {
      const { data: media, error: lookupError } = await supabase
        .from("media")
        .select("id")
        .eq("id", mediaId)
        .eq("entity_type", "product")
        .eq("entity_id", id)
        .eq("status", "ready")
        .maybeSingle();
      if (lookupError) return { error: lookupError.message };
      if (!media) {
        return { error: "That image is not a finished catalog photo for this product." };
      }
    }

    const { error } = await supabase
      .from("products")
      .update({ primary_media_id: mediaId })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/owner/admin");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function setProductActive(id: string, active: boolean): Promise<{ error: string | null }> {
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.from("products").update({ active }).eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/owner/admin");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

// ─── Workshops (Phase 2B, module 08) ────────────────────────────────────────

export interface WorkshopInput {
  name: string;
  type: string;
  manager_name?: string;
  manager_phone?: string;
  manager_salesperson_id?: string;
  address?: string;
}

/** The API's `detail` is the operator-facing message (409 duplicate name, 409 open
 *  items, 422 bad phone) — surface it verbatim rather than paraphrasing. */
async function readApiError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "string") return body.detail;
    if (body && Array.isArray(body.detail) && body.detail.length > 0) {
      const first = body.detail[0];
      if (first && typeof first.msg === "string") return first.msg;
    }
  } catch {
    // non-JSON
  }
  return `Request failed (${resp.status})`;
}

function apiFailure(err: unknown): string {
  if (err instanceof Error && err.name === "TimeoutError") {
    return "The workshops service did not respond in time — refresh and try again.";
  }
  return err instanceof Error ? err.message : "Server error";
}

/** Validate at the boundary so the operator gets the fix, not a 422 round-trip. */
function validateWorkshop(input: WorkshopInput, requireName: boolean): string | null {
  if (requireName && !input.name.trim()) return "Workshop name is required";
  if (input.name.trim().length > 120) return "Workshop name must be 120 characters or fewer";
  if (input.type && input.type !== "own" && input.type !== "vendor") {
    return "Type must be either 'own' or 'vendor'";
  }
  const phone = input.manager_phone?.trim();
  if (phone && !E164.test(phone)) {
    return "Manager phone must be in E.164 form, e.g. +919876543210";
  }
  return null;
}

/** Only send the fields the operator actually filled in — the API PATCH is sparse. */
function workshopBody(input: WorkshopInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.name.trim(),
    type: input.type === "vendor" ? "vendor" : "own",
    manager_name: input.manager_name?.trim() || null,
    manager_phone: input.manager_phone?.trim() || null,
    manager_salesperson_id: input.manager_salesperson_id || null,
    address: input.address?.trim() || null,
  };
  return body;
}

export async function addWorkshop(input: WorkshopInput): Promise<{ error: string | null }> {
  if (!DASHBOARD_API_KEY) return { error: "Workshops API not configured — set DASHBOARD_API_KEY" };
  const invalid = validateWorkshop(input, true);
  if (invalid) return { error: invalid };

  try {
    const resp = await fetch(WORKSHOPS_API, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(true),
      body: JSON.stringify(workshopBody(input)),
    });
    if (!resp.ok) return { error: await readApiError(resp) };
    revalidatePath("/owner/admin");
    revalidatePath("/dashboard/production/allocate");
    return { error: null };
  } catch (err) {
    return { error: apiFailure(err) };
  }
}

export async function updateWorkshop(
  id: string,
  input: WorkshopInput,
): Promise<{ error: string | null }> {
  if (!DASHBOARD_API_KEY) return { error: "Workshops API not configured — set DASHBOARD_API_KEY" };
  if (!id) return { error: "Missing workshop id" };
  const invalid = validateWorkshop(input, true);
  if (invalid) return { error: invalid };

  try {
    const resp = await fetch(`${WORKSHOPS_API}/${id}`, {
      method: "PATCH",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(true),
      body: JSON.stringify(workshopBody(input)),
    });
    if (!resp.ok) return { error: await readApiError(resp) };
    revalidatePath("/owner/admin");
    revalidatePath("/dashboard/production/allocate");
    return { error: null };
  } catch (err) {
    return { error: apiFailure(err) };
  }
}

/**
 * Retire a workshop. The API refuses (409) while it still holds unfinished items;
 * that message names the count and the fix, so it is shown verbatim.
 */
export async function deactivateWorkshop(id: string): Promise<{ error: string | null }> {
  if (!DASHBOARD_API_KEY) return { error: "Workshops API not configured — set DASHBOARD_API_KEY" };
  if (!id) return { error: "Missing workshop id" };

  try {
    const resp = await fetch(`${WORKSHOPS_API}/${id}/deactivate`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (!resp.ok) return { error: await readApiError(resp) };
    revalidatePath("/owner/admin");
    revalidatePath("/dashboard/production/allocate");
    return { error: null };
  } catch (err) {
    return { error: apiFailure(err) };
  }
}

export async function saveSetting(key: string, value: unknown): Promise<{ error: string | null }> {
  try {
    const supabase = await createServerSupabaseClient();
    // value is stored as jsonb; supabase-js serialises the JS value.
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value: value as never }, { onConflict: "key" });
    if (error) return { error: error.message };
    revalidatePath("/owner/admin");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
