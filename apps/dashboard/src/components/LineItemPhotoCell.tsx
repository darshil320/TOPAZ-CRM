"use client";

/**
 * The photo beside a quotation / order line: what is attached, and how to change it.
 *
 * The image itself is resolved on the server (`lib/media/lineItemPhotos.ts`) and
 * passed in already signed — this component never fetches it. That is the whole
 * reason the table paints its thumbnails in one go instead of filling in row by
 * row: Next.js serialises Server Actions, so a per-row fetch is a queue.
 *
 * "Catalog" on a thumbnail means the line has no photo of its own and is
 * inheriting the product's. Uploading here creates the per-line override — the
 * same precedence the job card renders with.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageOff, RefreshCw } from "lucide-react";
import MediaUpload from "@/components/media/MediaUpload";
import { createJobCard } from "@/lib/jobCard/actions";
import type { LinePhoto } from "@/lib/media/lineItemPhotos";

export default function LineItemPhotoCell({
  entityType,
  entityId,
  parentId,
  photo = null,
  description,
}: {
  entityType: "quotation_item" | "order_item";
  entityId: string;
  parentId?: string;
  /** Already-signed thumbnail for this line, resolved server-side. */
  photo?: LinePhoto | null;
  /** Used for the image alt text. */
  description?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleUploaded() {
    // Close first: the upload has already succeeded, and the two calls below are
    // bookkeeping the user should not be made to watch.
    setOpen(false);
    startTransition(() => {
      // Re-render the job card so the printed sheet carries the new photo, and
      // refresh this page for the new thumbnail. Concurrent — the refresh does
      // not wait on the render request.
      if (parentId) {
        void createJobCard(entityType === "quotation_item" ? "quotation" : "order", parentId);
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-1.5 flex items-start gap-2.5">
      {photo ? (
        <a
          href={photo.url}
          target="_blank"
          rel="noreferrer"
          title={photo.fromCatalog ? "Catalog photo — upload one here to override it" : "Open full size"}
          className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-ln bg-sf2 hover:border-accL transition-colors"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt={description ? `Photo of ${description}` : "Line item photo"}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          {photo.fromCatalog && (
            <span className="absolute inset-x-0 bottom-0 bg-sf/90 px-1 py-[1px] text-center text-[9px] font-semibold uppercase tracking-[.06em] text-t3">
              Catalog
            </span>
          )}
        </a>
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-ln bg-sf2 text-t3">
          <ImageOff className="h-4 w-4" strokeWidth={1.7} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-acc hover:underline disabled:opacity-50"
          title="Upload a photo for this line — it overrides the catalog photo on job cards"
        >
          {photo && !photo.fromCatalog ? (
            <RefreshCw className="h-3 w-3 shrink-0" strokeWidth={2} />
          ) : (
            <Camera className="h-3 w-3 shrink-0" strokeWidth={2} />
          )}
          {open
            ? "Close uploader"
            : pending
              ? "Saving…"
              : photo && !photo.fromCatalog
                ? "Replace photo"
                : photo
                  ? "Override catalog photo"
                  : "Add item photo"}
        </button>

        {open && (
          <div className="mt-1.5 rounded-md border border-ln bg-sf2 p-2 text-left">
            <MediaUpload
              entityType={entityType}
              entityId={entityId}
              kind="reference"
              label="Item photo"
              onUploaded={handleUploaded}
            />
          </div>
        )}
      </div>
    </div>
  );
}
