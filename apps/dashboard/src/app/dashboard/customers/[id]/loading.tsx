import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-3.5 w-24" />
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex items-start gap-4">
        <Skeleton className="w-12 h-12 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
          <Skeleton className="h-2.5 w-32" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}
