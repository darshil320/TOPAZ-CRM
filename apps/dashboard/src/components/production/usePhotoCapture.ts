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
        const signed = await signUpload({
          entityType: target.entityType,
          entityId,
          kind: target.kind,
          mime,
        });
        if (signed.error || !signed.data?.upload_url || !signed.data?.media_id) {
          throw new Error(signed.error || "Could not start the upload");
        }

        const put = await fetch(signed.data.upload_url, {
          method: "PUT",
          headers: { "Content-Type": file.type || "image/jpeg" },
          body: file,
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);

        const completed = await completeUpload(signed.data.media_id, file.size);
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
