"use client";

/**
 * One camera tap → a ready `media_id`.
 *
 * Extracted because three screens need the identical three-step dance (sign → PUT the
 * bytes to the signed URL → complete) and each of them gates a button on it:
 *   · the workshop queue's photo_required stages,
 *   · the destination lead's Receive,
 *   · the courier's Pickup and Deliver.
 *
 * Keyed by an arbitrary slot id so one hook instance serves a whole LIST of cards
 * without each card owning its own state — and so a manager with nine items open does
 * not get nine uploaders fighting over one shared `uploading` flag.
 */

import { useCallback, useRef, useState } from "react";
import {
  completeUpload,
  signUpload,
  type MediaEntityType,
  type MediaKind,
  type MediaMime,
} from "@/lib/media/actions";

/** The API's mime allowlist. Anything a phone hands us that is not png/webp is sent
 *  as jpeg — which is what `capture="environment"` produces on every Android we care
 *  about, and the API re-derives the real extension from this value anyway. */
const PASSTHROUGH_MIME: Record<string, MediaMime> = {
  "image/png": "image/png",
  "image/webp": "image/webp",
};

/**
 * Compression targets — matched to MediaUpload's, which this hook previously
 * lacked entirely. A modern phone camera hands us 4–8 MB per frame; on shop-floor
 * 4G that was a 10–20 second upload with the button locked the whole time, per
 * photo. At 1.5 MB / 2000px it is a second or two, and 2000px is still far more
 * detail than a stage-proof photo needs.
 */
const TARGET_MB = 1.5;
const MAX_EDGE_PX = 2000;

async function compress(file: File, mime: MediaMime): Promise<File> {
  const { default: imageCompression } = await import("browser-image-compression");
  return imageCompression(file, {
    maxSizeMB: TARGET_MB,
    maxWidthOrHeight: MAX_EDGE_PX,
    fileType: mime,
    useWebWorker: true,
    initialQuality: 0.82,
  });
}

export interface PhotoSlot {
  mediaId: string | null;
  previewUrl: string | null;
  uploading: boolean;
  error: string | null;
}

const EMPTY: PhotoSlot = { mediaId: null, previewUrl: null, uploading: false, error: null };

export function usePhotoCapture(target: { entityType: MediaEntityType; kind: MediaKind }) {
  const [slots, setSlots] = useState<Record<string, PhotoSlot>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const slot = useCallback((id: string): PhotoSlot => slots[id] ?? EMPTY, [slots]);

  const setInputRef = useCallback((id: string) => {
    return (el: HTMLInputElement | null) => {
      inputRefs.current[id] = el;
    };
  }, []);

  const openCamera = useCallback((id: string) => {
    inputRefs.current[id]?.click();
  }, []);

  const clear = useCallback((id: string) => {
    setSlots((prev) => {
      const next = { ...prev };
      const stale = next[id]?.previewUrl;
      // Release the blob: a manager working through twenty items would otherwise hold
      // twenty full-resolution photos in memory on a mid-range Android.
      if (stale) URL.revokeObjectURL(stale);
      delete next[id];
      return next;
    });
  }, []);

  /**
   * `entityId` is passed per call, not per hook: the slot key and the entity are the
   * same thing for the queue (one photo per item) but NOT for the courier app, where
   * pickup and delivery are two photos against one consignment.
   */
  const upload = useCallback(
    async (id: string, entityId: string, file: File): Promise<string | null> => {
      const previewUrl = URL.createObjectURL(file);
      setSlots((prev) => ({
        ...prev,
        [id]: { mediaId: null, previewUrl, uploading: true, error: null },
      }));

      try {
        const mime = (PASSTHROUGH_MIME[file.type] || "image/jpeg") as MediaMime;

        // Shrink BEFORE signing: the signed URL has a short TTL, and burning it
        // while a 6 MB frame compresses is how an upload link expires mid-flight.
        // A compressor failure is not fatal — fall back to the original bytes.
        let blob: File = file;
        try {
          blob = await compress(file, mime);
        } catch {
          blob = file;
        }

        const signed = await signUpload({
          entityType: target.entityType,
          entityId,
          kind: target.kind,
          mime,
        });
        if (signed.error || !signed.data?.upload_url || !signed.data?.media_id) {
          throw new Error(signed.error || "Could not start the upload");
        }
        if (signed.data.max_bytes && blob.size > signed.data.max_bytes) {
          throw new Error(
            `Photo is ${(blob.size / 1024 / 1024).toFixed(1)} MB after compression — ` +
              "take a new photo instead of uploading a scan.",
          );
        }

        const put = await fetch(signed.data.upload_url, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: blob,
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);

        const completed = await completeUpload(signed.data.media_id, blob.size);
        if (completed.error) throw new Error(completed.error);

        const mediaId = signed.data.media_id;
        setSlots((prev) => ({
          ...prev,
          [id]: { mediaId, previewUrl, uploading: false, error: null },
        }));
        return mediaId;
      } catch (err) {
        URL.revokeObjectURL(previewUrl);
        setSlots((prev) => ({
          ...prev,
          [id]: {
            mediaId: null,
            previewUrl: null,
            uploading: false,
            error: err instanceof Error ? err.message : "Photo upload failed",
          },
        }));
        return null;
      }
    },
    [target.entityType, target.kind],
  );

  return { slot, upload, clear, openCamera, setInputRef };
}
