import { Skeleton } from "@/components/Skeleton";

/** Instant placeholder for the product form. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Skeleton className="h-6 w-48" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-32 w-full rounded-card" />
      ))}
    </div>
  );
}
