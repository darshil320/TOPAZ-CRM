import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-3.5 w-24" />
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-3.5 w-56" />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
