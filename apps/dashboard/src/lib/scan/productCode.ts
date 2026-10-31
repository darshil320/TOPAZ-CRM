/**
 * Product QR codes, dashboard side — the TypeScript twin of
 * apps/api/src/services/product_codes.py (0053). Pure, import-free, unit-tested by
 * productCode.test.ts (`npm run test:unit`).
 *
 * A sticker encodes `<base>/p/<CODE>`. The scanner reads ANY QR, so the text is
 * untrusted: we only ever pull a well-formed code out of it and route to our own
 * /p/<code>. A foreign URL is never navigated to — a QR on someone else's poster
 * cannot send a staff phone anywhere.
 */

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const SEPARATORS = /[\s\-_]/g;
/** Crockford aliases: what a scuffed sticker or a hurried thumb gets wrong. */
const ALIASES: Record<string, string> = { O: "0", I: "1", L: "1" };
const MAX_INPUT = 512;

/** Canonical code, or null when `raw` cannot be one. */
export function normalizeProductCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 32) return null;
  const cleaned = raw
    .replace(SEPARATORS, "")
    .toUpperCase()
    .replace(/[OIL]/g, (c) => ALIASES[c] ?? c);
  return CODE_RE.test(cleaned) ? cleaned : null;
}

/**
 * The product code inside whatever a QR held: a sticker URL (`…/p/<code>`, any host,
 * trailing slash or query tolerated) or a bare code typed by hand. Null otherwise.
 */
export function extractProductCode(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_INPUT) return null;

  const bare = normalizeProductCode(trimmed);
  if (bare) return bare;

  let path: string;
  try {
    path = new URL(trimmed).pathname;
  } catch {
    return null;
  }
  const match = /\/p\/([^/]+)\/?$/i.exec(path);
  if (!match) return null;
  try {
    return normalizeProductCode(decodeURIComponent(match[1]));
  } catch {
    return null; // a malformed %-escape is just not one of ours
  }
}

/** Our own route for a code. Always relative — never a foreign origin. */
export function productPath(code: string): string {
  return `/p/${code}`;
}
