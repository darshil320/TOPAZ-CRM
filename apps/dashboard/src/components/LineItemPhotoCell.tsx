"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MediaUpload from "@/components/media/MediaUpload";
import { createJobCard } from "@/lib/jobCard/actions";

export default function LineItemPhotoCell({
  entityType,
  entityId,
  parentId,
}: {
  entityType: "quotation_item" | "order_item";
  entityId: string;
  parentId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function handleUploaded() {
    setOpen(false);
    startTransition(async () => {
      if (parentId) {
        const source = entityType === "quotation_item" ? "quotation" : "order";
        await createJobCard(source, parentId);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1 mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-acc hover:underline text-left cursor-pointer"
        title="Upload a photo specifically for this item (overrides catalog photo on job cards)"
      >
        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {open ? "Close uploader" : "Add item photo"}
      </button>

      {open && (
        <div className="mt-1.5 p-2 bg-sf2 border border-ln rounded-md text-left">
          <MediaUpload
            entityType={entityType}
            entityId={entityId}
            kind="reference"
            onUploaded={handleUploaded}
          />
        </div>
      )}
    </div>
  );
}
