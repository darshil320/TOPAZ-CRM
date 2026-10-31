/**
 * Product catalog reads for staff (0053). Server-only: the client is the caller's own
 * Supabase session, so RLS and the product_prices gate decide what comes back — the
 * role checks here only skip queries that would return nothing anyway.
 *
 * Price/GST/HSN are read from the `product_prices` view, never from `products`.
 * Pending migration 0054 revokes those columns of `products` from every browser JWT;
 * a select of `products.base_price` anywhere in the dashboard breaks the day it ships.
 *
 * The customer view is NOT here — it goes through the API's allowlisted public route
 * (lib/products/publicRead.ts). A customer never has a Supabase session.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getMediaUrls } from "@/lib/media/actions";
import { canViewPrices, canViewStock } from "@/lib/roles";
import type { ProductOption } from "@/app/dashboard/quotes/types";
import type { ProductPhoto, ProductPrice, StaffProduct, StockAt, StockLocation } from "./types";

type Client = SupabaseClient<Database>;

export const PRODUCT_COLUMNS =
  "id, name, category, description, sizes, dimensions, material, finish, unit, stock_status, active, primary_media_id, qr_code";

const MAX_PHOTOS = 12;

export async function listLocations(supabase: Client): Promise<StockLocation[]> {
  const { data, error } = await supabase
    .from("stock_locations")
    .select("id, code, name, sort")
    .eq("active", true)
    .order("sort");
  if (error) console.error("stock_locations read failed", error);
  return data ?? [];
}

export async function listCategories(supabase: Client): Promise<string[]> {
  const { data, error } = await supabase.from("product_categories").select("category");
  if (error) console.error("product_categories read failed", error);
  return (data ?? [])
    .map((r) => r.category)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/** Prices for some products, keyed by id. Empty for roles without PRICE_VIEW. */
export async function pricesFor(
  supabase: Client,
  role: string | null | undefined,
  productIds: string[],
): Promise<Map<string, ProductPrice>> {
  if (!canViewPrices(role) || productIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("product_prices")
    .select("product_id, base_price, gst_rate, hsn")
    .in("product_id", productIds);
  if (error) console.error("product_prices read failed", error);
  return new Map(
    (data ?? []).map((p) => [
      p.product_id,
      { base_price: p.base_price, gst_rate: Number(p.gst_rate), hsn: p.hsn },
    ]),
  );
}

/** {product_id → {location_id → qty}}. Empty for roles without STOCK_VIEW. */
export async function stockFor(
  supabase: Client,
  role: string | null | undefined,
  productIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (!canViewStock(role) || productIds.length === 0) return out;
  const { data, error } = await supabase
    .from("product_stock")
    .select("product_id, location_id, quantity")
    .in("product_id", productIds);
  if (error) console.error("product_stock read failed", error);
  for (const row of data ?? []) {
    const byLocation = out.get(row.product_id) ?? new Map<string, number>();
    out.set(row.product_id, new Map(byLocation).set(row.location_id, row.quantity));
  }
  return out;
}

/** Every location in display order, with this product's quantity (0 when no row). */
export function stockAtLocations(
  locations: StockLocation[],
  quantities: Map<string, number> | undefined,
): StockAt[] {
  return locations.map((location) => ({
    location,
    quantity: quantities?.get(location.id) ?? 0,
  }));
}

/**
 * The quote builder's product picker: active catalog + prices from ONE query on the
 * product_prices view (it carries name/unit too). Two separately row-capped queries
 * could pair a product with the wrong GST rate; a failed read returns no options —
 * lines are then typed by hand — rather than defaulting tax.
 */
export async function listQuoteProductOptions(supabase: Client): Promise<ProductOption[]> {
  const { data, error } = await supabase
    .from("product_prices")
    .select("product_id, name, unit, hsn, gst_rate, base_price")
    .eq("active", true)
    .order("name");
  if (error) {
    console.error("quote product options read failed", error);
    return [];
  }
  return (data ?? []).map((p) => ({
    id: p.product_id,
    name: p.name,
    unit: p.unit,
    hsn: p.hsn,
    gst_rate: Number(p.gst_rate),
    base_price: p.base_price,
  }));
}

async function productPhotos(supabase: Client, productId: string, primaryId: string | null) {
  const { data, error } = await supabase
    .from("media")
    .select("id")
    .eq("entity_type", "product")
    .eq("entity_id", productId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(MAX_PHOTOS);
  if (error) console.error("product media read failed", error);
  const ids = (data ?? []).map((m) => m.id);
  // The chosen cover photo leads, whatever its age.
  return primaryId && ids.includes(primaryId) ? [primaryId, ...ids.filter((i) => i !== primaryId)] : ids;
}

async function signPhotos(mediaIds: string[]): Promise<ProductPhoto[]> {
  if (mediaIds.length === 0) return [];
  const [full, thumbs] = await Promise.all([getMediaUrls(mediaIds, false), getMediaUrls(mediaIds, true)]);
  return mediaIds.flatMap((id) => {
    const url = full.data?.[id]?.url;
    return url ? [{ mediaId: id, url, thumbUrl: thumbs.data?.[id]?.url ?? null }] : [];
  });
}

/** One product as staff see it, by sticker code or by id. Null when not visible. */
export async function getStaffProduct(
  supabase: Client,
  role: string | null | undefined,
  key: { code: string } | { id: string },
): Promise<StaffProduct | null> {
  const base = supabase.from("products").select(PRODUCT_COLUMNS);
  const { data: product, error } = await ("code" in key
    ? base.eq("qr_code", key.code)
    : base.eq("id", key.id)
  ).maybeSingle();
  if (error) console.error("product read failed", error);
  if (!product) return null;

  const [prices, stock, locations, mediaIds] = await Promise.all([
    pricesFor(supabase, role, [product.id]),
    stockFor(supabase, role, [product.id]),
    canViewStock(role) ? listLocations(supabase) : Promise.resolve([]),
    productPhotos(supabase, product.id, product.primary_media_id),
  ]);
  const photos = await signPhotos(mediaIds);

  return {
    id: product.id,
    code: product.qr_code,
    name: product.name,
    category: product.category,
    description: product.description,
    sizes: product.sizes,
    dimensions: product.dimensions,
    material: product.material,
    finish: product.finish,
    unit: product.unit,
    stock_status: product.stock_status,
    active: product.active,
    primary_media_id: product.primary_media_id,
    price: prices.get(product.id) ?? null,
    stock: canViewStock(role) ? stockAtLocations(locations, stock.get(product.id)) : null,
    photos,
  };
}
