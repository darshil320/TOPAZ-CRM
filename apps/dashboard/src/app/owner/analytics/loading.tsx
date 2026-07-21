import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-2">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
          <Skeleton className="h-2.5 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  );
}
