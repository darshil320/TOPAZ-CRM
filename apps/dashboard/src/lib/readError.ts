/**
 * Turn a failed PostgREST read into something the person looking at the screen can act on.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The list pages rendered a fixed string — "Failed to load orders — refresh the page." —
 * and dropped `error` on the floor. When the app was deployed ahead of its migration the
 * real cause was `column orders.fulfillment_status does not exist`, and the screen's advice
 * was to refresh, which could never work. Nobody could diagnose it from the UI.
 *
 * The write path already does this properly (see the dispatch board's `humanizeWriteError`,
 * which names the missing migration). This is the read-side equivalent.
 *
 * The raw message is ALSO logged server-side: these are Server Components, so `console.error`
 * lands in the platform log, not the browser — the detail is kept for whoever is debugging
 * without putting a Postgres error in front of a showroom manager.
 */

export interface ReadFailure {
  /** One sentence, actionable, safe to render. */
  message: string;
  /** True when the fix is a deploy/migration rather than anything the user can do. */
  needsMigration: boolean;
}

/** A PostgREST error shape, loosely — only what we branch on. */
interface PostgrestLikeError {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export function describeReadError(
  error: PostgrestLikeError | null | undefined,
  what: string,
): ReadFailure | null {
  if (!error) return null;

  const raw = error.message ?? "";
  // Server-side only — this is a Server Component. Keeps the real cause recoverable.
  console.error(`[read] failed to load ${what}:`, error.code ?? "", raw);

  // 42703 undefined_column / 42P01 undefined_table — the database is behind the app. This is
  // the one failure mode a refresh can never fix, so say so instead of advising one.
  if (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /does not exist|schema cache/i.test(raw)
  ) {
    return {
      message: `Could not load ${what}: the database is missing a column or table this version of the app expects. A migration has not been applied yet — refreshing will not help.`,
      needsMigration: true,
    };
  }

  if (error.code === "42501" || /permission denied|row-level security/i.test(raw)) {
    return {
      message: `Could not load ${what}: your account does not have access. Ask the owner or an admin to check your role.`,
      needsMigration: false,
    };
  }

  return {
    message: `Could not load ${what} — refresh the page. If it keeps happening, send this to support: ${
      error.code || "unknown error"
    }.`,
    needsMigration: false,
  };
}
