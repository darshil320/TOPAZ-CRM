/**
 * Browser-side Supabase client (reads via RLS; no service-role key here — §19-G).
 * Uses @supabase/ssr so cookies are synced with Next.js middleware.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
