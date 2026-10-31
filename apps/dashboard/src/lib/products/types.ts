/**
 * Product catalog + stock shapes (0053). Pure — shared by server reads, server actions
 * and client components.
 */
import type { PillTone } from "@/components/ui/Pill";

export const STOCK_STATUSES = ["in_stock", "low_stock", "out_of_stock", "made_to_order"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
  made_to_order: "Made to order",
};

export const STOCK_STATUS_TONE: Record<StockStatus, PillTone> = {
  in_stock: "pos",
  low_stock: "warn",
  out_of_stock: "warn",
  made_to_order: "neutral",
};

export function isStockStatus(value: unknown): value is StockStatus {
  return typeof value === "string" && (STOCK_STATUSES as readonly string[]).includes(value);
}

export function stockStatusLabel(value: string | null | undefined): string {
  return isStockStatus(value) ? STOCK_STATUS_LABEL[value] : "—";
}

export interface StockLocation {
  id: string;
  code: string;
  name: string;
  sort: number;
}

/** Quantity at one location. Locations with no stock row read as 0. */
export interface StockAt {
  location: StockLocation;
  quantity: number;
}

/** Price/GST — present only when the caller's role may see it (product_prices view). */
export interface ProductPrice {
  base_price: number | null;
  gst_rate: number;
  hsn: string;
}

export interface ProductPhoto {
  mediaId: string;
  url: string;
  thumbUrl: string | null;
}

/** The staff view of one product: what a scan or the detail page shows. */
export interface StaffProduct {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  sizes: string | null;
  dimensions: string | null;
  material: string | null;
  finish: string | null;
  unit: string | null;
  stock_status: string;
  active: boolean;
  primary_media_id: string | null;
  /** Null ⇒ the caller's role may not see prices. */
  price: ProductPrice | null;
  /** Null ⇒ the caller's role may not see stock/locations. */
  stock: StockAt[] | null;
  photos: ProductPhoto[];
}

/** The editable record the form sends to the API (api/products.py ProductSave). */
export interface ProductInput {
  name: string;
  category: string;
  description: string;
  sizes: string;
  dimensions: string;
  material: string;
  finish: string;
  base_price: string;
  gst_rate: string;
  hsn: string;
  unit: string;
  stock_status: StockStatus;
  /** location_id → quantity as typed. */
  stock: Record<string, string>;
}

export function totalQuantity(stock: StockAt[] | null): number {
  return (stock ?? []).reduce((sum, s) => sum + s.quantity, 0);
}
