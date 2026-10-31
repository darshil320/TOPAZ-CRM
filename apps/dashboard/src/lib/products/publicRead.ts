/**
 * The CUSTOMER view of a product, for /p/[code] when nobody is signed in.
 *
 * Server-only, and deliberately not Supabase: a customer has no session, and `anon`
 * holds no privilege on the catalog (0053). The API's public route selects an
 * allowlist of columns; this module then parses the reply through a schema that knows
 * only those fields, so even a misbehaving API could not put a price into the page —
 * zod drops every key it does not declare.
 */
import { z } from "zod";

const SERVER_API = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 8_000;

const PublicProductSchema = z.object({
  code: z.string(),
  name: z.string(),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sizes: z.string().nullable().optional(),
  dimensions: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  finish: z.string().nullable().optional(),
  photos: z
    .array(z.object({ url: z.string().url(), thumb_url: z.string().url().nullable().optional() }))
    .default([]),
});

export type PublicProduct = z.infer<typeof PublicProductSchema>;

export type PublicLoad =
  | { status: "ok"; product: PublicProduct }
  | { status: "not_found" }
  | { status: "unavailable" };

export async function loadPublicProduct(code: string): Promise<PublicLoad> {
  try {
    const resp = await fetch(`${SERVER_API}/api/public/products/${encodeURIComponent(code)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (resp.status === 404) return { status: "not_found" };
    if (!resp.ok) {
      console.error("public product read failed", resp.status);
      return { status: "unavailable" };
    }
    const parsed = PublicProductSchema.safeParse(await resp.json());
    if (!parsed.success) {
      console.error("public product reply did not match the schema", parsed.error.issues);
      return { status: "unavailable" };
    }
    return { status: "ok", product: parsed.data };
  } catch (err) {
    console.error("public product read failed", err);
    return { status: "unavailable" };
  }
}
