"use client";

/**
 * Owner/admin tools on a product page: add photos (camera-first), choose the cover,
 * activate / deactivate. Every write re-checks on the server (products RLS, the media
 * ownership check in setProductCover, "admin removes nothing" in setProductActive).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import MediaUpload from "@/components/media/MediaUpload";
import Button from "@/components/ui/Button";
import { setProductActive, setProductCover } from "@/lib/products/actions";
import type { ProductPhoto } from "@/lib/products/types";

export function PhotoManager({
  productId,
  photos,
  coverId,
}: {
  productId: string;
  photos: ProductPhoto[];
  coverId: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const makeCover = (mediaId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await setProductCover(productId, mediaId);
      if (result.error) setError(result.error);
    });

  const onUploaded = (mediaId: string) =>
    startTransition(async () => {
      // A product with no cover takes its first photo as the cover automatically.
      if (!coverId) {
        const result = await setProductCover(productId, mediaId);
        if (result.error) setError(`Photo saved, but not set as cover: ${result.error}`);
      }
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <MediaUpload entityType="product" entityId={productId} kind="reference" label="Add photos" onUploaded={onUploaded} />
      {photos.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p) => (
            <li key={p.mediaId} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-ln">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
              <img src={p.thumbUrl ?? p.url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                disabled={isPending || p.mediaId === coverId}
                onClick={() => makeCover(p.mediaId)}
                aria-label={p.mediaId === coverId ? "Cover photo" : "Make cover photo"}
                className="absolute right-0.5 top-0.5 rounded-pill bg-sf/90 p-1 text-t2 disabled:text-acc"
              >
                <Star className="h-3 w-3" fill={p.mediaId === coverId ? "currentColor" : "none"} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-caption text-warn">{error}</p>}
    </div>
  );
}

export function ActiveToggle({
  productId,
  active,
  mayDeactivate,
}: {
  productId: string;
  active: boolean;
  mayDeactivate: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  if (active && !mayDeactivate) return null;

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="secondary"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await setProductActive(productId, !active);
            if (result.error) setError(result.error);
          })
        }
      >
        {active ? "Deactivate" : "Reactivate"}
      </Button>
      {active && <span className="text-meta text-t3">Deactivated products show &quot;not found&quot; to customers.</span>}
      {error && <span className="text-caption text-warn">{error}</span>}
    </div>
  );
}
