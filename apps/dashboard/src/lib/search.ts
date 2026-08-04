/**
 * Pure helpers for URL-driven list search / filtering.
 *
 * No I/O and no Supabase types on purpose — the query builders in
 * `listSearch.ts` wrap these. Everything here is a string transformation, so
 * the rules below are the single place where user input is made safe before it
 * reaches a PostgREST filter expression.
 */

/** Longest term we accept. Anything past this is noise (or an attack). */
const MAX_TERM_LENGTH = 64;

/**
 * Ceiling on ids inlined into a PostgREST `in.(…)` filter. Related-row lookups
 * (customers matching a name, quotes matching a number) are capped at this so a
 * one-character search can't build a URL past the gateway's header limit —
 * every id costs ~37 bytes and a list query can carry two of these lists.
 * Lookups take the most recent rows first, so an over-broad term degrades to
 * "recent matches only" rather than failing. A term this broad is not a real
 * search — the user is expected to type more.
 */
export const MAX_RELATED_IDS = 200;

/**
 * Characters that change the meaning of a PostgREST filter string
 * (`or=(a.ilike.x,b.eq.y)`) or of an ILIKE pattern (`%`, `_` wildcards).
 * None of them are meaningful inside a customer name, phone number or document
 * number, so they are dropped rather than escaped.
 */
const UNSAFE_PATTERN_CHARS = /[,()%_\\"*]/g;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A filter that matches no row. Used when a search term was supplied but
 * nothing searchable survived sanitising — showing the unfiltered list would
 * read as "everything matches", which is a lie.
 */
export const NO_MATCH_FILTER = "id.eq.00000000-0000-0000-0000-000000000000";

/** Trim + length-cap a raw query-string value. Returns null when empty. */
export function normalizeSearchTerm(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, MAX_TERM_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/** `%term%` with filter-breaking characters removed. Null if nothing is left. */
export function ilikePattern(term: string): string | null {
  const safe = term.replace(UNSAFE_PATTERN_CHARS, "").trim();
  return safe.length > 0 ? `%${safe}%` : null;
}

/** Digits only — "+91 98765 43210" → "919876543210". */
export function digitsOnly(term: string): string {
  return term.replace(/\D/g, "");
}

/** Shortest digit run we treat as a phone-number search (below this it matches everything). */
export const MIN_PHONE_DIGITS = 3;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

/** A validated uuid from a query-string value, or null. */
export function uuidParam(raw: string | null | undefined): string | null {
  return isUuid(raw) ? (raw as string) : null;
}

/** `col.in.(id,id)` over uuid-validated, capped ids. Null when the list is empty. */
export function inFilter(column: string, ids: readonly string[]): string | null {
  const safe = ids.filter(isUuid).slice(0, MAX_RELATED_IDS);
  return safe.length > 0 ? `${column}.in.(${safe.join(",")})` : null;
}

/** Join filter fragments for `.or()`, dropping the empty ones. */
export function orFilter(parts: ReadonlyArray<string | null>): string | null {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join(",") : null;
}
