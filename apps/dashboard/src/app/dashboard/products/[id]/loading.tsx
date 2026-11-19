import { Skeleton } from "@/components/Skeleton";

/** Instant placeholder for a product page (photos, prices, stock, QR load behind it). */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Skeleton className="h-3.5 w-20" />
      <Skeleton className="h-6 w-64" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="aspect-[4/3] w-full rounded-card" />
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-card" />
          <Skeleton className="h-28 w-full rounded-card" />
          <Skeleton className="h-36 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
