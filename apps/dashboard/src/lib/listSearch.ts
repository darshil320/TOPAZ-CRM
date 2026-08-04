/**
 * Server-side search resolution for the Orders and Quotations lists.
 *
 * PostgREST cannot `or` across an embedded table, so a search that spans
 * orders + customers + quotations is resolved in two hops: look the related
 * rows up first (RLS applies to those reads exactly as it does to the list),
 * then fold their ids into a single `or(...)` filter on the list query.
 *
 * Every fragment is built through `search.ts`, which is where user input is
 * sanitised — nothing here concatenates a raw term into a filter string.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";
import {
  MAX_RELATED_IDS,
  MIN_PHONE_DIGITS,
  NO_MATCH_FILTER,
  digitsOnly,
  ilikePattern,
  inFilter,
  isUuid,
  orFilter,
} from "./search";

type Client = SupabaseClient<Database>;

/**
 * Phone patterns to try for a term. Numbers are stored as typed at the kiosk
 * ("+91 98765 43210" or "9876543210"), so we probe the literal text, the
 * digits-only form, and the last ten digits — that last one is what makes a
 * "+91…" search find a locally-stored number and vice versa.
 *
 * Limitation: a digits-only search cannot match a stored number that contains
 * separators. Normalising `customers.phone` to E.164 on write is the real fix.
 */
function phonePatterns(term: string): string[] {
  const digits = digitsOnly(term);
  if (digits.length < MIN_PHONE_DIGITS) return [];

  const candidates = digits.length > 10 ? [digits, digits.slice(-10)] : [digits];
  return Array.from(new Set(candidates)).map((d) => `%${d}%`);
}

/** Ids of customers whose name, phone or WhatsApp id matches the term. */
async function matchingCustomerIds(supabase: Client, term: string): Promise<string[]> {
  const pattern = ilikePattern(term);
  const parts: (string | null)[] = [pattern ? `name.ilike.${pattern}` : null];

  if (pattern) {
    parts.push(`phone.ilike.${pattern}`, `wa_id.ilike.${pattern}`);
  }
  for (const p of phonePatterns(term)) {
    parts.push(`phone.ilike.${p}`, `wa_id.ilike.${p}`);
  }

  const filter = orFilter(parts);
  if (!filter) return [];

  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .or(filter)
    .order("created_at", { ascending: false })
    .limit(MAX_RELATED_IDS);

  if (error) {
    console.error("customer search lookup failed", error);
    return [];
  }
  return (data ?? []).map((c) => c.id);
}

/** Ids of quotations whose quote number matches the term. */
async function quotationIdsByNumber(supabase: Client, term: string): Promise<string[]> {
  const pattern = ilikePattern(term);
  if (!pattern) return [];

  const { data, error } = await supabase
    .from("quotations")
    .select("id")
    .ilike("quote_no", pattern)
    .order("created_at", { ascending: false })
    .limit(MAX_RELATED_IDS);

  if (error) {
    console.error("quotation number lookup failed", error);
    return [];
  }
  return (data ?? []).map((q) => q.id);
}

/** Quotation ids behind the orders whose order number matches the term. */
async function quotationIdsByOrderNumber(supabase: Client, term: string): Promise<string[]> {
  const pattern = ilikePattern(term);
  if (!pattern) return [];

  const { data, error } = await supabase
    .from("orders")
    .select("quotation_id")
    .ilike("order_no", pattern)
    .not("quotation_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_RELATED_IDS);

  if (error) {
    console.error("order number lookup failed", error);
    return [];
  }
  return (data ?? []).map((o) => o.quotation_id).filter((id): id is string => isUuid(id));
}

/**
 * `or(...)` filter for the orders list: order number, order id, the customer
 * (name / phone / WhatsApp id) and the source quotation's number.
 */
export async function buildOrderSearchFilter(supabase: Client, term: string): Promise<string> {
  const pattern = ilikePattern(term);
  const [customerIds, quotationIds] = await Promise.all([
    matchingCustomerIds(supabase, term),
    quotationIdsByNumber(supabase, term),
  ]);

  return (
    orFilter([
      pattern ? `order_no.ilike.${pattern}` : null,
      isUuid(term) ? `id.eq.${term}` : null,
      inFilter("customer_id", customerIds),
      inFilter("quotation_id", quotationIds),
    ]) ?? NO_MATCH_FILTER
  );
}

/**
 * `or(...)` filter for the quotations list: quote number, quote id, the
 * customer (name / phone / WhatsApp id) and the number of the order the quote
 * became.
 */
export async function buildQuoteSearchFilter(supabase: Client, term: string): Promise<string> {
  const pattern = ilikePattern(term);
  const [customerIds, quotationIds] = await Promise.all([
    matchingCustomerIds(supabase, term),
    quotationIdsByOrderNumber(supabase, term),
  ]);

  return (
    orFilter([
      pattern ? `quote_no.ilike.${pattern}` : null,
      isUuid(term) ? `id.eq.${term}` : null,
      inFilter("customer_id", customerIds),
      inFilter("id", quotationIds),
    ]) ?? NO_MATCH_FILTER
  );
}
