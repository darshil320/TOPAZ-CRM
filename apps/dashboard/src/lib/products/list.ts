/**
 * The product list query — search + filters, server-side under the caller's RLS.
 *
 * Every user-supplied value is validated before it reaches PostgREST: the term goes
 * through search.ts's sanitiser, category / location / status must match a known
 * value, so a crafted query string can only ever narrow the list.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { NO_MATCH_FILTER, ilikePattern } from "@/lib/search";
import { normalizeProductCode } from "@/lib/scan/productCode";
import type { StockStatus } from "./types";

type Client = SupabaseClient<Database>;

export type ActiveFilter = "active" | "inactive" | "all";

export interface ProductListFilters {
  term: string | null;
  category: string | null;
  /** stock_locations.id — "has at least one piece here". */
  locationId: string | null;
  status: StockStatus | null;
  show: ActiveFilter;
  from: number;
  to: number;
}

export interface ProductListRow {
  id: string;
  name: string;
  category: string | null;
  dimensions: string | null;
  stock_status: string;
  qr_code: string;
  active: boolean;
  primary_media_id: string | null;
}

const LIST_COLUMNS = "id, name, category, dimensions, stock_status, qr_code, active, primary_media_id";

/** `or(...)` over name / category / description / code for a search term. */
export function productSearchFilter(term: string): string {
  const pattern = ilikePattern(term);
  const code = normalizeProductCode(term);
  const parts = [
    pattern ? `name.ilike.${pattern}` : null,
    pattern ? `category.ilike.${pattern}` : null,
    pattern ? `description.ilike.${pattern}` : null,
    code ? `qr_code.eq.${code}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(",") : NO_MATCH_FILTER;
}

export async function listProducts(
  supabase: Client,
  f: ProductListFilters,
): Promise<{ rows: ProductListRow[]; count: number; error: { message?: string; code?: string } | null }> {
  // The location filter is an INNER embed: only products with a stock row at that
  // location and quantity > 0 survive, counted correctly, in one round-trip.
  const columns = f.locationId ? `${LIST_COLUMNS}, product_stock!inner(location_id)` : LIST_COLUMNS;
  let query = supabase.from("products").select(columns, { count: "exact" });

  if (f.locationId) {
    query = query.eq("product_stock.location_id", f.locationId).gt("product_stock.quantity", 0);
  }
  if (f.term) query = query.or(productSearchFilter(f.term));
  if (f.category) query = query.eq("category", f.category);
  if (f.status) query = query.eq("stock_status", f.status);
  if (f.show !== "all") query = query.eq("active", f.show === "active");

  const { data, count, error } = await query.order("name").range(f.from, f.to);
  if (error) console.error("product list read failed", error);
  const rows = ((data ?? []) as unknown as ProductListRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    dimensions: r.dimensions,
    stock_status: r.stock_status,
    qr_code: r.qr_code,
    active: r.active,
    primary_media_id: r.primary_media_id,
  }));
  return { rows, count: count ?? rows.length, error };
}
