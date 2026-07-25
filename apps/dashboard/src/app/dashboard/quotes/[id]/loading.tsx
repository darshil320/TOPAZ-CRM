import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-3.5 w-24" />
      <div className="rounded-card border border-ln bg-sf p-5 shadow-sh space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-56" />
      </div>
      <div className="rounded-card border border-ln bg-sf p-5 shadow-sh">
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
