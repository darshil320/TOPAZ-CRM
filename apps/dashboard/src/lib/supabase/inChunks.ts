/**
 * Run a `.in(column, ids)` read in URL-safe batches.
 *
 * WHY THIS EXISTS: scoping a read to "the ids this page is showing" is the right fix
 * for an unbounded scan, but PostgREST reads take their filters in the QUERY STRING,
 * so the id list becomes URL text — ~37 bytes per UUID. A few hundred ids is a
 * multi-kilobyte URL, and past the gateway's limit the request fails outright rather
 * than degrading. The payments page scopes to 500 orders, which is squarely over it.
 *
 * `CHUNK_SIZE` is deliberately conservative: 200 ids ≈ 7.5 KB of filter, comfortably
 * inside the smallest limit in the chain (proxies, not Postgres) with room for the
 * rest of the query.
 *
 * Chunks are issued CONCURRENTLY — this splits one oversized request into a few
 * parallel ones, it does not serialise them.
 *
 * NOT A SILENT CAP: every id is fetched. A chunk that errors contributes no rows and
 * its error is returned, so the caller can tell "no balance due" apart from "the
 * balances did not load".
 */

export const CHUNK_SIZE = 200;

export interface ChunkedResult<T> {
  data: T[];
  error: string | null;
}

/**
 * @param ids     the values to filter on; de-duplicated before use
 * @param fetcher runs ONE chunk. Given a slice of ids, returns the PostgREST result.
 */
export async function selectInChunks<T>(
  ids: string[],
  fetcher: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<ChunkedResult<T>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return { data: [], error: null };

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + CHUNK_SIZE));
  }

  const results = await Promise.all(chunks.map((chunk) => fetcher(chunk)));

  const data: T[] = [];
  let error: string | null = null;
  for (const result of results) {
    if (result.error) {
      // Keep the first failure; the caller shows one message, not one per chunk.
      error ??= result.error.message;
      continue;
    }
    if (result.data) data.push(...result.data);
  }
  return { data, error };
}
