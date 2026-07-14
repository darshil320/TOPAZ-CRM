import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-5 space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3.5 w-48" />
      </div>
      <div className="flex gap-3 overflow-hidden sm:grid sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="shrink-0 w-[80%] min-w-[220px] sm:w-auto sm:min-w-0 rounded-2xl border border-slate-200 bg-slate-50/80 p-2 space-y-1.5"
          >
            <Skeleton className="h-6 w-full mb-2" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
