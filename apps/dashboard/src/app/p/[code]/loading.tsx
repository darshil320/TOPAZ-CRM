import { Skeleton } from "@/components/Skeleton";

/** Shown the instant a scan navigates here, while the product is read. */
export default function Loading() {
  return (
    <div className="min-h-screen bg-bg px-4 py-6">
      <div className="mx-auto max-w-lg space-y-4">
        <Skeleton className="mx-auto h-4 w-32" />
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-24 w-full rounded-card" />
      </div>
    </div>
  );
}
