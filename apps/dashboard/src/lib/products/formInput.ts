/** Form state for ProductForm — blank for create, prefilled for edit. Pure. */
import { isStockStatus, type ProductInput, type StaffProduct, type StockLocation } from "./types";

const DEFAULT_HSN = "9403";
const DEFAULT_GST = "18";
const DEFAULT_UNIT = "nos";

export function blankProductInput(locations: StockLocation[]): ProductInput {
  return {
    name: "",
    category: "",
    description: "",
    sizes: "",
    dimensions: "",
    material: "",
    finish: "",
    base_price: "",
    gst_rate: DEFAULT_GST,
    hsn: DEFAULT_HSN,
    unit: DEFAULT_UNIT,
    stock_status: "out_of_stock",
    stock: Object.fromEntries(locations.map((l) => [l.id, "0"])),
  };
}

export function productInputFrom(product: StaffProduct, locations: StockLocation[]): ProductInput {
  const byLocation = new Map((product.stock ?? []).map((s) => [s.location.id, s.quantity]));
  return {
    name: product.name,
    category: product.category ?? "",
    description: product.description ?? "",
    sizes: product.sizes ?? "",
    dimensions: product.dimensions ?? "",
    material: product.material ?? "",
    finish: product.finish ?? "",
    base_price: product.price?.base_price != null ? String(product.price.base_price) : "",
    gst_rate: product.price ? String(product.price.gst_rate) : DEFAULT_GST,
    hsn: product.price?.hsn ?? DEFAULT_HSN,
    unit: product.unit ?? DEFAULT_UNIT,
    stock_status: isStockStatus(product.stock_status) ? product.stock_status : "in_stock",
    stock: Object.fromEntries(locations.map((l) => [l.id, String(byLocation.get(l.id) ?? 0)])),
  };
}
