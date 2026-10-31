/**
 * One image, end to end: compress (browser-image-compression) → POST sign-upload →
 * PUT the blob straight to the signed Storage URL → POST complete.
 *
 * Browser-only. Extracted from MediaUpload so a form can collect photos BEFORE its
 * entity exists (the product form: take photos while typing, upload them the moment
 * Save returns an id) and still go through the exact same pipeline.
 *
 * Rules (unchanged from MediaUpload):
 *  - Enforce the API's own `max_bytes` (returned by sign-upload), not a guess.
 *  - `complete` is idempotent server-side, so retrying after a flaky network is safe.
 *  - The service-role key never touches the browser: the signed URL is minted by the
 *    FastAPI server action, and the PUT carries no credentials of its own.
 */
import {
  signUpload,
  completeUpload,
  type MediaEntityType,
  type MediaKind,
  type MediaMime,
} from "@/lib/media/actions";

// Compression targets. Deliberately generous — a workshop photo has to stay
// legible as evidence; the API's max_bytes is the real ceiling.
const TARGET_MB = 1.5;
const MAX_EDGE_PX = 2000;

const PASSTHROUGH_MIME: Record<string, MediaMime> = {
  "image/png": "image/png",
  "image/webp": "image/webp",
};

export type UploadStep = "compressing" | "uploading" | "finalising";

export interface UploadTarget {
  entityType: MediaEntityType;
  entityId: string;
  kind: MediaKind;
}

export interface UploadOutcome {
  /** Set as soon as sign-upload reserved a row, even if a later step failed. */
  mediaId: string | null;
  error: string | null;
}

function outputMimeFor(file: File): MediaMime {
  return PASSTHROUGH_MIME[file.type] ?? "image/jpeg";
}

async function compress(file: File, mime: MediaMime, maxMB: number): Promise<File> {
  const { default: imageCompression } = await import("browser-image-compression");
  return imageCompression(file, {
    maxSizeMB: maxMB,
    maxWidthOrHeight: MAX_EDGE_PX,
    fileType: mime,
    useWebWorker: true,
    initialQuality: 0.82,
  });
}

/** PUT the blob to the signed Storage URL, reporting real upload progress. */
function putToStorage(
  url: string,
  blob: Blob,
  mime: string,
  onProgress: (pct: number) => void,
): Promise<{ error: string | null }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.timeout = 60_000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () =>
      resolve(
        xhr.status >= 200 && xhr.status < 300
          ? { error: null }
          : {
              error:
                xhr.status === 400
                  ? "The upload link expired — tap Retry to get a fresh one."
                  : `Storage rejected the upload (${xhr.status}) — tap Retry.`,
            },
      );
    xhr.onerror = () => resolve({ error: "Network dropped during the upload — tap Retry." });
    xhr.ontimeout = () => resolve({ error: "The upload timed out — tap Retry on a better signal." });
    xhr.send(blob);
  });
}

export async function uploadImage(
  file: File,
  target: UploadTarget,
  onStep: (step: UploadStep, progress: number) => void = () => {},
): Promise<UploadOutcome> {
  const mime = outputMimeFor(file);
  onStep("compressing", 0);

  let blob: File;
  try {
    blob = await compress(file, mime, TARGET_MB);
  } catch {
    return { mediaId: null, error: "Could not read that image — retake it or pick a different file." };
  }

  const signed = await signUpload({ ...target, mime });
  if (signed.error || !signed.data) {
    return { mediaId: null, error: signed.error ?? "Could not start the upload." };
  }
  const { media_id, upload_url, max_bytes } = signed.data;

  // Enforce the API's ceiling, not our guess. One extra squeeze, then give up with an
  // instruction rather than a rejected PUT the user cannot interpret.
  if (blob.size > max_bytes) {
    try {
      blob = await compress(file, mime, (max_bytes * 0.9) / (1024 * 1024));
    } catch {
      // fall through to the size check below
    }
  }
  if (blob.size > max_bytes) {
    const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
    return {
      mediaId: media_id,
      error: `Still ${mb(blob.size)} MB after compression (limit ${mb(max_bytes)} MB) — take a new photo instead of uploading a scan.`,
    };
  }

  onStep("uploading", 1);
  const put = await putToStorage(upload_url, blob, mime, (pct) => onStep("uploading", pct));
  if (put.error) return { mediaId: media_id, error: put.error };

  onStep("finalising", 100);
  const done = await completeUpload(media_id, blob.size);
  if (done.error) return { mediaId: media_id, error: done.error ?? "Could not confirm the upload." };

  return { mediaId: media_id, error: null };
}
