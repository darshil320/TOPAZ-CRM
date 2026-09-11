"use client";

/**
 * Call recordings on a lead — playback list (always visible) + upload control
 * (creator/owner only).
 *
 * File upload (`<input type="file" accept="audio/*">`), not in-browser
 * MediaRecorder capture — no recording precedent exists in this repo, and live
 * capture is a materially bigger feature than what was asked.
 *
 * Fetches its own list on mount and after a successful upload — no
 * router.refresh(), same rationale as LeadEditForm: there is nothing to
 * revalidate via Supabase RLS here (recordings are read through the API, not the
 * page's direct-Supabase query), so a local re-fetch is the correct analogue.
 *
 * Upload queue is modeled on components/media/MediaUpload.tsx but simplified: no
 * compressing phase (browser-image-compression is image-only and does not apply
 * to audio), and no client-side shrink retry — an oversized recording cannot be
 * losslessly shrunk here, so a 422 just states the limit.
 */

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatDate } from "@/lib/format";
import {
  completeLeadAudioUpload,
  listLeadRecordings,
  signLeadAudioUpload,
  type LeadAudioMime,
  type LeadRecording,
} from "@/lib/leadAudio/actions";

type Props = { leadId: string; canEdit: boolean };

type Phase = "queued" | "uploading" | "finalising" | "done" | "error";

interface QueueEntry {
  key: string;
  name: string;
  phase: Phase;
  error: string | null;
}

const ACCEPTED_MIMES: LeadAudioMime[] = [
  "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav",
];

function mimeFor(file: File): LeadAudioMime | null {
  return (ACCEPTED_MIMES as string[]).includes(file.type) ? (file.type as LeadAudioMime) : null;
}

/** PUT the file straight to the signed Storage URL. */
function putToStorage(url: string, file: File): Promise<{ error: string | null }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.timeout = 60_000;
    xhr.onload = () =>
      resolve(
        xhr.status >= 200 && xhr.status < 300
          ? { error: null }
          : {
              error:
                xhr.status === 400
                  ? "The upload link expired — try again."
                  : `Storage rejected the upload (${xhr.status}) — try again.`,
            },
      );
    xhr.onerror = () => resolve({ error: "Network dropped during the upload — try again." });
    xhr.ontimeout = () => resolve({ error: "The upload timed out — try again on a better signal." });
    xhr.send(file);
  });
}

export default function LeadAudioRecordings({ leadId, canEdit }: Props) {
  const [recordings, setRecordings] = useState<LeadRecording[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [entry, setEntry] = useState<QueueEntry | null>(null);

  async function refresh() {
    const res = await listLeadRecordings(leadId);
    if (res.error) {
      setListError(res.error);
      return;
    }
    setListError(null);
    setRecordings(res.data ?? []);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function handleFile(file: File) {
    const mime = mimeFor(file);
    const key = `${file.name}-${file.size}-${file.lastModified}`;
    if (!mime) {
      setEntry({
        key, name: file.name, phase: "error",
        error: `Unsupported file type '${file.type || "unknown"}'. Allowed: ${ACCEPTED_MIMES.join(", ")}.`,
      });
      return;
    }

    setEntry({ key, name: file.name, phase: "queued", error: null });

    const signed = await signLeadAudioUpload(leadId, mime, note);
    if (signed.error || !signed.data) {
      setEntry({ key, name: file.name, phase: "error", error: signed.error ?? "Could not start the upload." });
      return;
    }

    setEntry({ key, name: file.name, phase: "uploading", error: null });
    const put = await putToStorage(signed.data.upload_url, file);
    if (put.error) {
      setEntry({ key, name: file.name, phase: "error", error: put.error });
      return;
    }

    setEntry({ key, name: file.name, phase: "finalising", error: null });
    const complete = await completeLeadAudioUpload(leadId, signed.data.recording_id, file.size);
    if (complete.error) {
      setEntry({ key, name: file.name, phase: "error", error: complete.error });
      return;
    }

    setEntry({ key, name: file.name, phase: "done", error: null });
    setNote("");
    await refresh();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again
    if (file) handleFile(file);
  }

  return (
    <Card>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-ln">
          <label className="rounded-input border border-ln bg-sf px-3 py-1.5 text-caption font-semibold text-t1 hover:border-accL cursor-pointer transition-colors">
            Add a recording
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              onChange={onPick}
              disabled={entry?.phase === "uploading" || entry?.phase === "finalising"}
            />
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g. follow-up call)"
            className="flex-1 min-w-[180px] rounded-input border border-ln bg-sf px-3 py-1.5 text-caption text-t1 placeholder:text-t3"
          />
        </div>
      )}

      {entry && (
        <div className="pb-3 mb-3 border-b border-ln text-caption">
          {entry.phase === "queued" && <span className="text-t3">Preparing {entry.name}…</span>}
          {entry.phase === "uploading" && <span className="text-t3">Uploading {entry.name}…</span>}
          {entry.phase === "finalising" && <span className="text-t3">Finishing {entry.name}…</span>}
          {entry.phase === "done" && <span className="text-pos">Added {entry.name}.</span>}
          {entry.phase === "error" && <span className="text-neg">{entry.error}</span>}
        </div>
      )}

      {listError ? (
        <p className="text-caption text-neg">{listError}</p>
      ) : recordings === null ? (
        <p className="text-caption text-t3">Loading…</p>
      ) : recordings.length === 0 ? (
        <p className="text-caption text-t3">No recordings yet.</p>
      ) : (
        <ul className="space-y-3">
          {recordings.map((rec) => (
            <li key={rec.id} className="space-y-1">
              <audio controls src={rec.url} className="w-full h-9" />
              <p className="text-caption text-t3">
                <span className="font-mono tabular-nums">{formatDate(rec.created_at)}</span>
                {rec.uploaded_by_name ? ` · ${rec.uploaded_by_name}` : ""}
                {rec.note ? ` · ${rec.note}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
