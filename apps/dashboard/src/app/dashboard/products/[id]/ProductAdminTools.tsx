"use client";

/**
 * Owner/admin tools on a product page: add photos (camera-first), choose the cover,
 * activate / deactivate. Every write re-checks on the server (products RLS, the media
 * ownership check in setProductCover, "admin removes nothing" in setProductActive).
 */
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import MediaUpload from "@/components/media/MediaUpload";
import Button from "@/components/ui/Button";
import { CATALOG_PHOTO } from "@/lib/media/uploadImage";
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
  const [, startTransition] = useTransition();
  // Optimistic: the star moves the moment it is tapped; useOptimistic snaps back on its
  // own if the server refuses (the error is shown).
  const [cover, setOptimisticCover] = useOptimistic(coverId);
  // Photos just uploaded, shown from memory at once — no wait for a signed URL round-trip.
  // They drop out as soon as the refreshed server list contains them.
  const [fresh, setFresh] = useState<{ mediaId: string; preview: string }[]>([]);
  const known = new Set(photos.map((p) => p.mediaId));
  const shown = [
    ...photos.map((p) => ({ mediaId: p.mediaId, src: p.thumbUrl ?? p.url })),
    ...fresh.filter((f) => !known.has(f.mediaId)).map((f) => ({ mediaId: f.mediaId, src: f.preview })),
  ];

  // Object URLs are released once, when the page goes away — revoking on every change
  // would blank previews that are still on screen.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const makeCover = (mediaId: string) =>
    startTransition(async () => {
      setError(null);
      setOptimisticCover(mediaId);
      const result = await setProductCover(productId, mediaId);
      if (result.error) setError(result.error);
    });

  const onUploaded = (mediaId: string, file: File) => {
    const preview = URL.createObjectURL(file);
    previews.current = [...previews.current, preview];
    setFresh((prev) => [...prev, { mediaId, preview }]);
    startTransition(async () => {
      // A product with no cover takes its first photo as the cover automatically.
      if (!coverId) {
        setOptimisticCover(mediaId);
        const result = await setProductCover(productId, mediaId);
        if (result.error) setError(`Photo saved, but not set as cover: ${result.error}`);
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <MediaUpload
        entityType="product"
        entityId={productId}
        kind="reference"
        label="Add photos"
        onUploaded={onUploaded}
        profile={CATALOG_PHOTO}
      />
      {shown.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {shown.map((p) => (
            <li key={p.mediaId} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-ln">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed URL or local preview */}
              <img src={p.src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              <button
                type="button"
                disabled={p.mediaId === cover}
                onClick={() => makeCover(p.mediaId)}
                aria-label={p.mediaId === cover ? "Cover photo" : "Make cover photo"}
                className="absolute right-0.5 top-0.5 rounded-pill bg-sf/90 p-1 text-t2 disabled:text-acc"
              >
                <Star className="h-3 w-3" fill={p.mediaId === cover ? "currentColor" : "none"} />
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
  const [, startTransition] = useTransition();
  const [shownActive, setShownActive] = useOptimistic(active);
  if (active && !mayDeactivate) return null;

  const toggle = () =>
    startTransition(async () => {
      setError(null);
      setShownActive(!active);
      const result = await setProductActive(productId, !active);
      if (result.error) setError(result.error);
    });

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="secondary" onClick={toggle}>
        {shownActive ? "Deactivate" : "Reactivate"}
      </Button>
      {shownActive && <span className="text-meta text-t3">Deactivated products show &quot;not found&quot; to customers.</span>}
      {error && <span className="text-caption text-warn">{error}</span>}
    </div>
  );
}
