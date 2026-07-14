/**
 * Per-request cached session helpers.
 *
 * Both the layout AND the page beneath it need the current user and their
 * salesperson record. Without deduplication each call hits Supabase over the
 * network (`auth.getUser()` validates the JWT against the auth server; the
 * salesperson lookup is a DB round-trip), so a single navigation fired 4-6
 * serial round-trips before anything rendered — the dashboard's main source of
 * lag.
 *
 * React `cache()` memoises the result for the lifetime of one server render
 * pass, so layout + page share a single `getUser()` and a single salesperson
 * query. Security is unchanged: middleware still refreshes/validates the
 * session on every request, and RLS still guards every row.
 *
 * Server-only by construction: the underlying client reads `next/headers`
 * cookies, which throws if imported into a client component.
 */
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "./supabase/server";

export type CurrentSalesperson = {
  id: string;
  name: string | null;
  role: string | null;
  available: boolean | null;
};

/** Authenticated user for this request, or null. Deduped per render. */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Active salesperson record linked to the current user, or null.
 * Selects a superset of every caller's needs so one query serves layout + page.
 */
export const getCurrentSalesperson = cache(
  async (): Promise<CurrentSalesperson | null> => {
    const user = await getSessionUser();
    if (!user) return null;

    const supabase = await createServerSupabaseClient();
    const { data } = await supabase
      .from("salespersons")
      .select("id, name, role, available")
      .eq("auth_uid", user.id)
      .eq("active", true)
      .single();

    return data;
  },
);

/** True when the current salesperson is an owner. */
export function isOwnerRole(sp: CurrentSalesperson | null): boolean {
  return sp?.role === "owner";
}
