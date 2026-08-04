/**
 * The photo shown beside a quotation / order line, resolved server-side.
 *
 * **Precedence mirrors the job card** (`apps/api/src/repositories/job_card_repo.py`)
 * on purpose: what the salesperson sees next to a line must be the same image the
 * workshop will get on the printed card. Any divergence here is a bug, not a
 * styling choice.
 *
 *   1. the line's own photo  (`quotation_item` / `order_item` media — the override)
 *   2. the catalog photo of its product (`product` media)
 *   3. nothing
 *
 * Why server-side and not a client component per row: Next.js serialises Server
 * Actions, so one `getMediaUrl` per line is N sequential round-trips with the
 * table visibly filling in. Here it is two Supabase queries plus one concurrent
 * sign batch, resolved before the page streams.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getMediaUrls } from "./actions";

export type LineEntityType = "quotation_item" | "order_item";

export interface LinePhoto {
  mediaId: string;
  url: string;
  /** False when the thumbnail worker has not run — we are showing the original. */
  isThumb: boolean;
  /** True when the image comes from the catalog product, not this line. */
  fromCatalog: boolean;
}

export interface PhotoSourceItem {
  id: string;
  product_id?: string | null;
}

interface MediaRow {
  id: string;
  entity_id: string;
  created_at: string;
}

/** Newest ready photo per entity id. */
async function newestByEntity(
  supabase: SupabaseClient<Database>,
  entityType: string,
  entityIds: string[],
): Promise<Map<string, string>> {
  const chosen = new Map<string, string>();
  if (entityIds.length === 0) return chosen;

  const { data, error } = await supabase
    .from("media")
    .select("id, entity_id, created_at")
    .eq("entity_type", entityType)
    .in("entity_id", entityIds)
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("line item photo lookup failed", error);
    return chosen;
  }

  // Ordered newest-first, so the FIRST row seen for an entity is the one to keep.
  for (const row of (data ?? []) as MediaRow[]) {
    if (!chosen.has(row.entity_id)) chosen.set(row.entity_id, row.id);
  }
  return chosen;
}

export async function loadLinePhotos(
  supabase: SupabaseClient<Database>,
  entityType: LineEntityType,
  items: PhotoSourceItem[],
): Promise<Map<string, LinePhoto>> {
  const result = new Map<string, LinePhoto>();
  if (items.length === 0) return result;

  const itemIds = items.map((i) => i.id);
  const productIds = Array.from(
    new Set(items.map((i) => i.product_id).filter((p): p is string => Boolean(p))),
  );

  const [ownPhotos, catalogPhotos] = await Promise.all([
    newestByEntity(supabase, entityType, itemIds),
    newestByEntity(supabase, "product", productIds),
  ]);

  // Decide the media id per line BEFORE signing, so a catalog photo shared by
  // five lines is signed once.
  const pick = new Map<string, { mediaId: string; fromCatalog: boolean }>();
  for (const item of items) {
    const own = ownPhotos.get(item.id);
    if (own) {
      pick.set(item.id, { mediaId: own, fromCatalog: false });
      continue;
    }
    const catalog = item.product_id ? catalogPhotos.get(item.product_id) : undefined;
    if (catalog) pick.set(item.id, { mediaId: catalog, fromCatalog: true });
  }
  if (pick.size === 0) return result;

  const signed = await getMediaUrls(
    Array.from(new Set(Array.from(pick.values()).map((p) => p.mediaId))),
    true,
  );

  for (const [itemId, choice] of pick) {
    const url = signed.data?.[choice.mediaId];
    if (!url) continue; // signing failed for this one — the cell shows "Add photo"
    result.set(itemId, {
      mediaId: choice.mediaId,
      url: url.url,
      isThumb: url.is_thumb,
      fromCatalog: choice.fromCatalog,
    });
  }
  return result;
}
