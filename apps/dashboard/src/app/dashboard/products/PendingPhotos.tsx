"use client";

/**
 * Photo picker for a product that does not exist yet. Photos are held in memory with
 * local previews; ProductForm uploads them (lib/media/uploadImage) the moment Save
 * returns the new product's id. Camera-first: the primary button opens the rear camera.
 */
import { useEffect, useRef } from "react";
import { Camera, ImagePlus, Loader2, X, Check } from "lucide-react";
import Button from "@/components/ui/Button";

export interface PendingPhoto {
  key: string;
  file: File;
  preview: string;
  state: "waiting" | "uploading" | "done" | "failed";
  progress: number;
}

const MAX_PENDING = 12;

export function toPending(files: FileList | null, existing: number): PendingPhoto[] {
  return Array.from(files ?? [])
    .slice(0, Math.max(0, MAX_PENDING - existing))
    .map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      file,
      preview: URL.createObjectURL(file),
      state: "waiting" as const,
      progress: 0,
    }));
}

export default function PendingPhotos({
  photos,
  onAdd,
  onRemove,
  locked,
}: {
  photos: PendingPhoto[];
  onAdd: (files: FileList | null) => void;
  onRemove: (key: string) => void;
  locked: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const previews = useRef(new Set<string>());

  // Release every object URL this picker ever created when the form goes away.
  useEffect(() => {
    photos.forEach((p) => previews.current.add(p.preview));
  }, [photos]);
  useEffect(() => {
    const created = previews.current;
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label uppercase text-t3">Photos</span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={locked} onClick={() => libraryRef.current?.click()}>
            <ImagePlus className="h-3.5 w-3.5" strokeWidth={2} /> Choose
          </Button>
          <Button type="button" disabled={locked} onClick={() => cameraRef.current?.click()}>
            <Camera className="h-3.5 w-3.5" strokeWidth={2} /> Take photo
          </Button>
        </div>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />

      {photos.length === 0 ? (
        <p className="text-caption text-t3">The first photo becomes the cover. You can add more later.</p>
      ) : (
        <ul className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <li key={p.key} className="relative aspect-square overflow-hidden rounded-md border border-ln bg-sf2">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
              <img src={p.preview} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              {p.state === "uploading" && (
                <span className="absolute inset-0 flex items-center justify-center bg-sf/70 font-mono text-meta tabular-nums text-t1">
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" /> {p.progress}%
                </span>
              )}
              {p.state === "done" && (
                <span className="absolute bottom-1 right-1 rounded-pill bg-posS p-0.5 text-pos">
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                </span>
              )}
              {p.state === "failed" && (
                <span className="absolute inset-x-0 bottom-0 bg-warnS px-1 text-center text-meta text-warn">Failed</span>
              )}
              {!locked && (
                <button
                  type="button"
                  onClick={() => onRemove(p.key)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-1 top-1 rounded-pill bg-sf/90 p-0.5 text-t2"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded-badge bg-sf/90 px-1 text-label-sm uppercase text-t2">Cover</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
