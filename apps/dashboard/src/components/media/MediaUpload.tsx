"use client";

/**
 * MediaUpload — camera-first image capture for the production/order flows.
 *
 * Pipeline per file: compress (browser-image-compression) → POST sign-upload →
 * PUT the compressed blob straight to the signed Storage URL → POST complete.
 * The pipeline itself lives in lib/media/uploadImage.ts; this component is the queue.
 *
 * Design rules this component exists to honour:
 *  - NEVER lose the user's tap. A failed step keeps the picked file in the queue
 *    with a Retry button; nothing is silently dropped.
 *  - Enforce the API's own `max_bytes` (returned by sign-upload), not a guess.
 *  - `complete` is idempotent server-side, so retrying after a flaky network is safe.
 *
 * The service-role key never touches the browser: the signed URL is minted by the
 * FastAPI server action, and the PUT carries no credentials of its own.
 */

import { useCallback, useRef, useState } from "react";
import { Camera, ImagePlus, RotateCcw, Check, X, Loader2 } from "lucide-react";
import Button, { IconButton } from "@/components/ui/Button";
import type { MediaEntityType, MediaKind } from "@/lib/media/actions";
import { uploadImage } from "@/lib/media/uploadImage";

type Phase = "queued" | "compressing" | "uploading" | "finalising" | "done" | "error";

interface QueueEntry {
  key: string;
  file: File;
  name: string;
  phase: Phase;
  /** 0–100, only meaningful while uploading. */
  progress: number;
  error: string | null;
  mediaId: string | null;
}

export interface MediaUploadProps {
  entityType: MediaEntityType;
  entityId: string;
  kind: MediaKind;
  /** Overline label above the picker. */
  label?: string;
  /** Called once per file that reaches `ready`. */
  onUploaded?: (mediaId: string) => void;
  className?: string;
}

function update(entries: QueueEntry[], key: string, patch: Partial<QueueEntry>): QueueEntry[] {
  return entries.map((e) => (e.key === key ? { ...e, ...patch } : e));
}

export default function MediaUpload({
  entityType,
  entityId,
  kind,
  label = "Photos",
  onUploaded,
  className,
}: MediaUploadProps) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const run = useCallback(
    async (entry: QueueEntry) => {
      const { key, file } = entry;
      setEntries((prev) => update(prev, key, { phase: "compressing", progress: 0, error: null }));

      const outcome = await uploadImage(file, { entityType, entityId, kind }, (step, progress) =>
        setEntries((prev) => update(prev, key, { phase: step, progress })),
      );
      if (outcome.error || !outcome.mediaId) {
        setEntries((prev) =>
          update(prev, key, {
            phase: "error",
            mediaId: outcome.mediaId,
            error: outcome.error ?? "Could not upload the photo.",
          }),
        );
        return;
      }

      setEntries((prev) => update(prev, key, { phase: "done", progress: 100, error: null }));
      onUploaded?.(outcome.mediaId);
    },
    [entityType, entityId, kind, onUploaded],
  );

  const enqueue = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const added: QueueEntry[] = Array.from(files).map((file, i) => ({
        key: `${Date.now()}-${i}-${file.name}`,
        file,
        name: file.name || "photo.jpg",
        phase: "queued" as Phase,
        progress: 0,
        error: null,
        mediaId: null,
      }));
      setEntries((prev) => [...prev, ...added]);
      added.forEach((entry) => void run(entry));
    },
    [run],
  );

  const retry = useCallback(
    (key: string) => {
      const entry = entries.find((e) => e.key === key);
      if (entry) void run(entry);
    },
    [entries, run],
  );

  const dismiss = useCallback((key: string) => {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  }, []);

  const busy = entries.some((e) => e.phase !== "done" && e.phase !== "error");

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-label uppercase text-t3">{label}</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => libraryRef.current?.click()}>
            <ImagePlus className="w-3.5 h-3.5" strokeWidth={2} />
            <span>Choose</span>
          </Button>
          <Button type="button" onClick={() => cameraRef.current?.click()} disabled={busy}>
            <Camera className="w-3.5 h-3.5" strokeWidth={2} />
            <span>{busy ? "Uploading…" : "Take photo"}</span>
          </Button>
        </div>
      </div>

      {/* Two inputs: the camera one opens the rear camera on a phone, the other the
          file library. A single input cannot do both. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          enqueue(e.target.files);
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
          enqueue(e.target.files);
          e.target.value = "";
        }}
      />

      {entries.length > 0 && (
        <ul className="mt-3 space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.key}
              className="rounded-card border border-ln bg-sf px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <span className="shrink-0">
                  {entry.phase === "done" ? (
                    <Check className="w-4 h-4 text-pos" strokeWidth={2} />
                  ) : entry.phase === "error" ? (
                    <X className="w-4 h-4 text-warn" strokeWidth={2} />
                  ) : (
                    <Loader2 className="w-4 h-4 text-t3 animate-spin" strokeWidth={2} />
                  )}
                </span>

                <span className="min-w-0 flex-1 truncate text-caption text-t1">{entry.name}</span>

                <span className="shrink-0 text-[11px] font-mono tabular-nums text-t3">
                  {entry.phase === "uploading"
                    ? `${entry.progress}%`
                    : entry.phase === "compressing"
                      ? "Compressing"
                      : entry.phase === "finalising"
                        ? "Finishing"
                        : entry.phase === "done"
                          ? "Saved"
                          : entry.phase === "error"
                            ? "Failed"
                            : "Queued"}
                </span>

                {entry.phase === "error" && (
                  <Button type="button" variant="secondary" onClick={() => retry(entry.key)}>
                    <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>Retry</span>
                  </Button>
                )}
                {(entry.phase === "done" || entry.phase === "error") && (
                  <IconButton
                    type="button"
                    aria-label={`Dismiss ${entry.name}`}
                    onClick={() => dismiss(entry.key)}
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={2} />
                  </IconButton>
                )}
              </div>

              {(entry.phase === "uploading" || entry.phase === "finalising") && (
                <div className="mt-2 h-1 w-full overflow-hidden rounded-pill bg-sf3">
                  <div
                    className="h-full rounded-pill bg-acc transition-[width] duration-150"
                    style={{ width: `${entry.progress}%` }}
                  />
                </div>
              )}

              {entry.error && (
                <p className="mt-1.5 text-[11px] text-warn">{entry.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
