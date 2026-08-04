"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

/**
 * Search + single-select filter bar for a server-rendered list.
 *
 * State lives in the URL, never in this component: the page is a Server
 * Component that reads `searchParams`, so a committed keystroke re-runs the
 * query server-side. That keeps search consistent with pagination (both are
 * query params), makes a filtered list linkable, and keeps RLS in charge of
 * what a search can reach.
 */

const DEBOUNCE_MS = 350;

export interface FilterOption {
  id: string;
  label: string;
}

interface Props {
  searchPlaceholder: string;
  /** Options for the dropdown. Fewer than two ⇒ the dropdown is hidden. */
  options: FilterOption[];
  /** Label of the "no filter" choice, e.g. "All salespersons". */
  allOptionLabel: string;
  /** Query-param names. Defaults match the list pages. */
  searchParam?: string;
  filterParam?: string;
}

export default function ListFilterBar({
  searchPlaceholder,
  options,
  allOptionLabel,
  searchParam = "q",
  filterParam = "sp",
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const urlQuery = searchParams.get(searchParam) ?? "";
  const selected = searchParams.get(filterParam) ?? "";

  const [query, setQuery] = useState(urlQuery);

  // Re-sync when the URL moves under us (back/forward, Clear, a link).
  useEffect(() => setQuery(urlQuery), [urlQuery]);

  const commit = useCallback(
    (next: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      // Any change to the result set invalidates the current page number.
      params.delete("page");

      const qs = params.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  // Debounce typing; the effect no-ops once the URL catches up.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === urlQuery) return;
    const timer = setTimeout(() => commit({ [searchParam]: trimmed }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, urlQuery, commit, searchParam]);

  const hasFilters = urlQuery !== "" || selected !== "";

  return (
    <div className="bg-sf rounded-card p-3 border border-ln shadow-sh flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="w-4 h-4 text-t3 absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.8} />
        <input
          type="search"
          value={query}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-1.5 bg-sf2 border border-ln rounded-md text-ui text-t1 placeholder-t3 focus:outline-none focus:border-acc focus:bg-sf transition-all"
        />
      </div>

      {options.length > 1 && (
        <select
          value={selected}
          aria-label={allOptionLabel}
          onChange={(e) => commit({ [filterParam]: e.target.value })}
          className="py-1.5 px-3 bg-sf2 border border-ln rounded-md text-ui text-t1 font-medium focus:outline-none focus:border-acc transition-all"
        >
          <option value="">{allOptionLabel}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-2 sm:ml-auto">
        {isPending && <span className="text-caption text-t3">Searching…</span>}
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              commit({ [searchParam]: "", [filterParam]: "" });
            }}
            className="flex items-center gap-1 py-1.5 px-2.5 rounded-md border border-ln bg-sf2 text-caption font-semibold text-t2 hover:border-accL hover:text-t1 transition-colors"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
