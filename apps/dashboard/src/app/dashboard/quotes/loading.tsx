import { Skeleton, SkeletonCardList } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>
      <SkeletonCardList rows={5} />
    </div>
  );
}
