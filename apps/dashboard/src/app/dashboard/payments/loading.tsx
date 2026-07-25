import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* PageHeader skeleton */}
      <div>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3.5 w-56 mt-1" />
      </div>

      {/* StatCardGrid skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[11px] mt-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-ln bg-sf p-[13px] px-[14px]">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-[18px] w-24 mt-[9px]" />
          </div>
        ))}
      </div>

      {/* SectionHeader + ListRow skeletons */}
      <div>
        <div className="mt-6">
          <Skeleton className="h-3.5 w-28" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="mt-2.5 flex items-center gap-3 rounded-card border border-ln bg-sf px-4 py-3.5">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
