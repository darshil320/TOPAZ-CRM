"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MediaUpload from "@/components/media/MediaUpload";
import { Camera, Image as ImageIcon } from "lucide-react";

export default function LineItemPhotoCell({
  entityType,
  entityId,
}: {
  entityType: "quotation_item" | "order_item";
  entityId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function handleUploaded() {
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1 mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-acc hover:underline text-left"
        title="Upload a photo specifically for this item (overrides catalog photo on job cards)"
      >
        <Camera className="w-3 h-3" />
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
