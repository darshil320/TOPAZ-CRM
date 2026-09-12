"use client";

import { useState } from "react";

/**
 * A line-item's thumbnail, tap-to-enlarge. Own client component (not the whole
 * item list) so the page/list stay server-rendered — only the bit of state
 * that needs a browser (open/closed) is client-side.
 *
 * Plain fixed overlay, no dialog/portal library: this page has no design-system
 * primitives (it isn't part of the dashboard's component set — see page.tsx),
 * and a lightbox is simple enough not to need one.
 */
export default function ItemPhoto({ url, alt }: { url: string; alt: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-100"
        aria-label="View photo"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL,
            short-lived, never worth Next/Image's build-time domain config */}
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white hover:bg-white/20"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </>
  );
}
