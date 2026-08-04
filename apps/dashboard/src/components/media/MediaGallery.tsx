"use client";

/**
 * MediaGallery — thumbnail grid for one (entity_type, entity_id).
 *
 * Reads the `media` registry straight from Supabase under RLS (the house read
 * pattern; the registry row carries no bytes), then asks the API for a short-lived
 * signed URL per image.
 *
 * NO BROKEN-IMAGE ICONS, EVER. `thumb_key` is nullable — the thumbnail worker is
 * best-effort — so each tile degrades in three steps:
 *   thumbnail → full image → a labelled placeholder tile.
 * The API already performs the first fallback server-side when `thumb_key` is
 * NULL; this component repeats it client-side for the case where the thumbnail
 * row exists but its object does not decode.
 */

import { useCallback, useEffect, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMediaUrl, getMediaUrls, type MediaEntityType, type MediaKind } from "@/lib/media/actions";

export interface MediaGalleryProps {
  entityType: MediaEntityType;
  entityId: string;
  /** Optional filter — omit to show every kind attached to the entity. */
  kind?: MediaKind;
  label?: string;
  /** Bump to re-read after an upload completes. */
  refreshKey?: number;
  className?: string;
}

interface MediaRow {
  id: string;
  kind: string;
  created_at: string;
}

type TileState = "loading" | "thumb" | "full" | "placeholder";

function TileFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-card border border-ln bg-sf2">
      {children}
    </div>
  );
}

function Placeholder({ note }: { note: string }) {
  return (
    <TileFrame>
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center">
        <ImageOff className="h-5 w-5 text-t3" strokeWidth={1.7} />
        <span className="text-[11px] text-t3">{note}</span>
      </div>
    </TileFrame>
  );
}

function MediaTile({ media, initialUrl }: { media: MediaRow; initialUrl?: string | null }) {
  // The URL arrives from the gallery's single batched call, so a tile normally
  // renders its image on first paint. `load` is only the per-tile FALLBACK path
  // (a thumbnail that will not decode), which is genuinely one-at-a-time.
  const [state, setState] = useState<TileState>(initialUrl ? "thumb" : "loading");
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [note, setNote] = useState("Preview unavailable");

  const load = useCallback(async (thumb: boolean) => {
    const result = await getMediaUrl(media.id, thumb);
    if (result.error || !result.data) {
      setNote(result.error ?? "Preview unavailable");
      setState("placeholder");
      return;
    }
    setUrl(result.data.url);
    setState(result.data.is_thumb ? "thumb" : "full");
  }, [media.id]);

  useEffect(() => {
    if (initialUrl) {
      setUrl(initialUrl);
      setState("thumb");
      return;
    }
    void load(true);
  }, [load, initialUrl]);

  if (state === "loading") {
    return (
      <TileFrame>
        <div className="h-full w-full animate-pulse bg-sf3" />
      </TileFrame>
    );
  }
  if (state === "placeholder" || !url) {
    return <Placeholder note={note} />;
  }

  return (
    <TileFrame>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${media.kind} photo`}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => {
          // A thumbnail that will not decode: fall back to the full image once,
          // then to the placeholder. Never leave the browser's broken icon.
          if (state === "thumb") {
            setState("loading");
            void load(false);
            return;
          }
          setNote("Image could not be loaded");
          setState("placeholder");
        }}
      />
      <span className="absolute bottom-1 left-1 rounded-badge bg-sf/90 px-1.5 py-0.5 text-[10px] font-560 uppercase tracking-[.08em] text-t3">
        {media.kind}
      </span>
    </TileFrame>
  );
}

export default function MediaGallery({
  entityType,
  entityId,
  kind,
  label = "Photos",
  refreshKey = 0,
  className,
}: MediaGalleryProps) {
  const [rows, setRows] = useState<MediaRow[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setError(null);
      try {
        const supabase = createClient();
        let query = supabase
          .from("media")
          .select("id, kind, created_at")
          .eq("entity_type", entityType)
          .eq("entity_id", entityId)
          .eq("status", "ready")
          .order("created_at", { ascending: false })
          .limit(60);
        if (kind) query = query.eq("kind", kind);

        const { data, error: queryError } = await query;
        if (cancelled) return;
        if (queryError) {
          setError("Could not load the photos — refresh the page.");
          setRows([]);
          return;
        }
        const mediaRows = (data ?? []) as MediaRow[];
        if (mediaRows.length === 0) {
          setRows([]);
          return;
        }

        // One batched sign for the whole grid — see getMediaUrls on why this is
        // not N calls. Rows are published TOGETHER with their URLs so no tile
        // mounts without one and falls back to its own per-tile request.
        const signed = await getMediaUrls(mediaRows.map((r) => r.id), true);
        if (cancelled) return;
        setUrls(
          Object.fromEntries(
            Object.entries(signed.data ?? {}).map(([id, value]) => [id, value.url]),
          ),
        );
        setRows(mediaRows);
      } catch {
        if (!cancelled) {
          setError("Could not load the photos — refresh the page.");
          setRows([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, kind, refreshKey]);

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between">
        <span className="text-label uppercase text-t3">{label}</span>
        {rows !== null && (
          <span className="text-[11px] font-mono tabular-nums text-t3">{rows.length}</span>
        )}
      </div>

      {error && <p className="mt-2 text-caption text-warn">{error}</p>}

      {rows === null ? (
        <div className="mt-2.5 flex items-center gap-2 text-caption text-t3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          <span>Loading photos…</span>
        </div>
      ) : rows.length === 0 ? (
        !error && <p className="mt-2.5 text-caption text-t3">No photos attached yet.</p>
      ) : (
        <div className="mt-2.5 grid grid-cols-3 gap-[11px] sm:grid-cols-4 lg:grid-cols-6">
          {rows.map((row) => (
            <MediaTile key={row.id} media={row} initialUrl={urls[row.id] ?? null} />
          ))}
        </div>
      )}
    </div>
  );
}
