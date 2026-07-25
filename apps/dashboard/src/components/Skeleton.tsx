/**
 * Tiny presentational skeleton block. Used by route-level `loading.tsx` files
 * so navigation renders an instant placeholder (via Suspense) instead of
 * blocking on Supabase round-trips.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/90 dark:bg-sf3/90 ${className}`} />;
}

/** A generic list of card-shaped skeleton rows. */
export function SkeletonCardList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3.5 bg-sf border border-ln rounded-card px-4 py-3.5 shadow-sh"
        >
          <Skeleton className="w-9 h-9 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
