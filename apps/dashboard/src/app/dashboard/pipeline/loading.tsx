import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-4 space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-56" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-64 shrink-0 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
