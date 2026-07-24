/** Shared types for the quotations UI (Module 02). */

export interface CustomerOption {
  id: string;
  name: string | null;
  phone: string | null;
}

export interface ProductOption {
  id: string;
  name: string;
  hsn: string;
  gst_rate: number;
  base_price: number | null;
  unit: string | null;
}

/**
 * One editable line in the builder. Numeric fields are kept as raw strings so
 * the EXACT value the user typed is what reaches the server (which parses it to
 * Decimal). Keeping them as JS numbers would risk float drift before the server
 * ever sees them.
 */
export interface LineDraft {
  key: string; // stable client-only key for React lists
  product_id: string | null;
  description: string;
  hsn: string;
  gst_rate: string;
  qty: string;
  unit: string;
  unit_price: string;
  dimensions: string;
  material: string;
  fabric: string;
  polish: string;
  customization: string;
}

/** An item as sent to the server action (snake_case, matches QuoteItemIn). */
export interface QuoteItemPayload {
  description: string;
  qty: string;
  unit_price: string;
  hsn: string;
  gst_rate: string;
  product_id: string | null;
  unit: string | null;
  dimensions: string | null;
  material: string | null;
  fabric: string | null;
  polish: string | null;
  customization: string | null;
}

/** Full payload the builder submits to createQuote / updateQuote. */
export interface QuotePayload {
  customer_id: string;
  discount: string;
  place_of_supply: string;
  valid_until: string | null;
  terms: string | null;
  notes: string | null;
  items: QuoteItemPayload[];
}
