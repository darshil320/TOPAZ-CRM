"use client";

/**
 * Product photo viewer — one large image, a thumbnail strip, tap to enlarge.
 * Shared by the customer page and the staff view, so it takes plain URLs and nothing
 * else (no ids, no keys). Signed URLs are short-lived; Next/Image's domain config
 * buys nothing for them.
 */
import { useState } from "react";
import { ImageOff, X } from "lucide-react";

export interface PhotoUrls {
  url: string;
  thumbUrl: string | null;
}

export default function ProductPhotos({ photos, alt }: { photos: PhotoUrls[]; alt: string }) {
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  if (photos.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-card border border-ln bg-sf2 text-t3">
        <ImageOff className="h-6 w-6" strokeWidth={1.7} />
        <span className="text-caption">No photos yet</span>
      </div>
    );
  }

  const current = photos[Math.min(index, photos.length - 1)];

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className="block aspect-[4/3] w-full overflow-hidden rounded-card border border-ln bg-sf2"
        aria-label="Enlarge photo"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
        <img
          src={current.url}
          alt={alt}
          className="h-full w-full object-cover"
          fetchPriority="high"
          decoding="async"
        />
      </button>

      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, i) => (
            <button
              key={p.url}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Photo ${i + 1}`}
              aria-current={i === index}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border ${
                i === index ? "border-acc" : "border-ln"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbUrl ?? p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
        >
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-pill bg-white/15 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.url}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </div>
      )}
    </div>
  );
}
