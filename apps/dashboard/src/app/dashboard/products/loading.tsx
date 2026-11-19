import { Skeleton, SkeletonCardList } from "@/components/Skeleton";

/** Instant placeholder while the product list's reads run (search, prices, stock, thumbnails). */
export default function Loading() {
  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-56" />
      </div>
      <Skeleton className="h-12 w-full" />
      <SkeletonCardList rows={6} />
    </div>
  );
}
