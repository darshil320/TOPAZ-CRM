import { Skeleton, SkeletonCardList } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3.5 w-20" />
      </div>
      <SkeletonCardList rows={5} />
    </div>
  );
}
