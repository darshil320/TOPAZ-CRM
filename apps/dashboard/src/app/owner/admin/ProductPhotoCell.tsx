"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MediaUpload from "@/components/media/MediaUpload";
import { setProductPrimaryPhoto } from "./actions";

/**
 * The CATALOG photo for one product (migration 0027).
 *
 * Why this matters: a job card line resolves its photo as
 *   line's own upload → this catalog photo → product's newest reference → none.
 * Setting it once here means every future quote and order line for this product
 * carries a photo without anybody re-uploading the same sofa. A custom one-off
 * piece still overrides with its own shot on the line itself.
 *
 * Upload goes through the FastAPI media route (MediaUpload); this component only
 * records WHICH uploaded image is primary.
 */
export default function ProductPhotoCell({
  productId,
  hasPhoto,
}: {
  productId: string;
  hasPhoto: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUploaded(mediaId: string) {
    setError(null);
    startTransition(async () => {
      const result = await setProductPrimaryPhoto(productId, mediaId);
      if (result.error) {
        // The bytes are already stored — only the "make it primary" step failed,
        // so say exactly that rather than implying the upload was lost.
        setError(`Photo uploaded, but could not set it as the catalog photo: ${result.error}`);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="text-[11px] text-t2 hover:text-t1 underline underline-offset-2 text-left disabled:opacity-60"
      >
        {hasPhoto ? "Replace photo" : "Add photo"}
      </button>

      {open && (
        <MediaUpload
          entityType="product"
          entityId={productId}
          kind="reference"
          label="Catalog photo"
          onUploaded={handleUploaded}
          className="mt-1"
        />
      )}

      {error && <span className="text-[11px] text-warn">{error}</span>}
    </div>
  );
}
