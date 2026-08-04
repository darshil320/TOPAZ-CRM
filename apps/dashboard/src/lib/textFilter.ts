/**
 * Client-side list matching for lists that are already fully in memory
 * (the PWAs' queues, a modal's option list).
 *
 * Deliberately not the same thing as `lib/search.ts`: that one sanitises a term
 * for a database round-trip, this one filters an array already on the device.
 * On a shop floor the device is offline half the time — filtering what is
 * already downloaded has to keep working when a query would not.
 *
 * Matching rule: every whitespace-separated token must appear somewhere in the
 * haystack, in any order ("sharma sofa" finds "2x Sofa … Sharma"). Digits are
 * also compared with separators stripped, so "9876543210" finds "+91 98765
 * 43210" and "GJ05XX1234" finds "GJ-05-XX-1234".
 */

/** Build one lowercase haystack from a row's searchable fields. */
export function haystack(...fields: Array<string | number | null | undefined>): string {
  return fields
    .filter((f) => f !== null && f !== undefined && f !== "")
    .join(" ")
    .toLowerCase();
}

const NON_ALNUM = /[^a-z0-9]/g;

/** True when every token of `query` appears in `text`. Empty query matches all. */
export function matchesQuery(text: string, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const collapsed = text.replace(NON_ALNUM, "");
  return tokens.every((token) => {
    if (text.includes(token)) return true;
    const collapsedToken = token.replace(NON_ALNUM, "");
    return collapsedToken.length > 0 && collapsed.includes(collapsedToken);
  });
}
