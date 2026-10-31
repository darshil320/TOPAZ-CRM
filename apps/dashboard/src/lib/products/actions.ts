"use server";

/**
 * Product writes (0053). Create/edit go through the API (api/products.py) because a
 * save is the product AND its stock at every location in one transaction — there is no
 * browser write grant on product_stock. Cover photo + active flag are single-column
 * edits that products RLS already gates to owner/admin, so they stay direct.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { apiCall } from "@/lib/apiFetch";
import { getCurrentSalesperson } from "@/lib/auth";
import { canManageProducts, canRemove } from "@/lib/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { STOCK_STATUSES, type ProductInput } from "./types";

const LIST_PATH = "/dashboard/products";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .transform((v) => v || null);

const quantity = z
  .string()
  .trim()
  .transform((v) => (v === "" ? "0" : v))
  .pipe(z.coerce.number().int("Stock must be a whole number").min(0, "Stock cannot be negative").max(100_000));

const ProductInputSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(200),
  category: optionalText(80),
  description: optionalText(4000),
  sizes: optionalText(300),
  dimensions: optionalText(300),
  material: optionalText(200),
  finish: optionalText(200),
  base_price: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 9_999_999_999), "Price must be a positive amount, e.g. 42000")
    .transform((v) => (v === "" ? null : v)),
  gst_rate: z
    .string()
    .trim()
    .refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v), "GST rate must be between 0 and 99.99"),
  hsn: z.string().trim().regex(/^\d{4,8}$/, "HSN must be 4–8 digits"),
  unit: z.string().trim().min(1).max(20),
  stock_status: z.enum(STOCK_STATUSES),
  stock: z.record(z.string().uuid(), quantity),
});

export interface SaveResult {
  error: string | null;
  data?: { id: string; qr_code: string; url: string };
}

const LoadedStockSchema = z.record(z.string().uuid(), quantity);

const toLines = (stock: Record<string, number>) =>
  Object.entries(stock).map(([location_id, qty]) => ({ location_id, quantity: qty }));

/**
 * Create (id = null) or fully replace (id) a product and its stock. On edit,
 * `loadedStock` is the stock the form opened with: the API refuses (409) if anyone
 * changed it since, instead of silently overwriting their count.
 */
export async function saveProduct(
  id: string | null,
  input: ProductInput,
  loadedStock?: Record<string, string>,
): Promise<SaveResult> {
  const sp = await getCurrentSalesperson();
  if (!canManageProducts(sp?.role)) return { error: "Only the owner or an admin can edit products" };

  const parsed = ProductInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const loaded = loadedStock ? LoadedStockSchema.safeParse(loadedStock) : null;
  if (loaded && !loaded.success) return { error: "Reload the page and try again" };
  const { stock, ...fields } = parsed.data;
  const body = {
    ...fields,
    stock: toLines(stock),
    ...(loaded?.success ? { stock_loaded: toLines(loaded.data) } : {}),
  };

  const result = id
    ? await apiCall<{ id: string; qr_code: string; url: string }>(`/api/products/${id}`, { method: "PUT", body })
    : await apiCall<{ id: string; qr_code: string; url: string }>("/api/products", { method: "POST", body });
  if (result.error || !result.data) return { error: result.error ?? "Could not save the product" };

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${result.data.id}`);
  return { error: null, data: result.data };
}

/**
 * Point a product at its cover photo. Verifies the media row really is THIS product's
 * finished catalog photo first: `primary_media_id` is a bare FK to media(id), and the
 * job card inlines whatever it points at (see job_card_repo) — it must never be aimed
 * at a customer's home photo.
 */
export async function setProductCover(productId: string, mediaId: string): Promise<{ error: string | null }> {
  try {
    if (!canManageProducts((await getCurrentSalesperson())?.role)) {
      return { error: "Only the owner or an admin can change product photos" };
    }
    const supabase = await createServerSupabaseClient();
    const { data: media, error: lookupError } = await supabase
      .from("media")
      .select("id")
      .eq("id", mediaId)
      .eq("entity_type", "product")
      .eq("entity_id", productId)
      .eq("status", "ready")
      .maybeSingle();
    if (lookupError) return { error: lookupError.message };
    if (!media) return { error: "That image is not a finished photo of this product." };

    // products_update RLS: owner/admin only. `.select` so a write RLS filtered out
    // reports as a failure instead of a silent success.
    const { data: updated, error } = await supabase
      .from("products")
      .update({ primary_media_id: mediaId })
      .eq("id", productId)
      .select("id");
    if (error) return { error: error.message };
    if (!updated?.length) return { error: "That product could not be updated — it may have been removed." };
    revalidatePath(`${LIST_PATH}/${productId}`);
    revalidatePath(LIST_PATH);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function setProductActive(id: string, active: boolean): Promise<{ error: string | null }> {
  try {
    // products_update RLS admits admin and cannot tell a deactivation from an edit, so
    // "admin removes nothing" (0052) is enforced here for this direct write.
    const role = (await getCurrentSalesperson())?.role;
    if (!canManageProducts(role)) return { error: "Only the owner or an admin can change this" };
    if (!active && !canRemove(role)) {
      return { error: "Admins can view and edit but cannot deactivate a product" };
    }
    const supabase = await createServerSupabaseClient();
    const { data: updated, error } = await supabase.from("products").update({ active }).eq("id", id).select("id");
    if (error) return { error: error.message };
    if (!updated?.length) return { error: "That product could not be updated — it may have been removed." };
    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${id}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function getProductQr(
  id: string,
): Promise<{ error: string | null; data?: { code: string; url: string; image: string } }> {
  // `image` is an SVG data URI generated by the API (segno) — rendered with <img>.
  const result = await apiCall<{ code: string; url: string; image: string }>(`/api/products/${id}/qr`);
  return result.error || !result.data ? { error: result.error ?? "QR unavailable" } : { error: null, data: result.data };
}
