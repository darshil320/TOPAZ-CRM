"use client";

import { useState, useTransition } from "react";
import { Share2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { getJobCardShare, type JobCardSource } from "@/lib/jobCard/actions";

/**
 * Share the job card with ANYONE — not just the customer or an allocated workshop.
 *
 * WHY THIS IS NOT A WHATSAPP SEND. The existing "Send to customer" / "Send to
 * workshop" buttons push media through the Meta Cloud API, which only permits
 * free-form media inside an open 24-hour customer-service window. An arbitrary
 * recipient — the customer's interior designer, a carpenter quoting on the job, a
 * relative — has never messaged the business, so that window is closed and no
 * approved template exists for a job card. A "send to any number" button would
 * therefore fail every time it was used. See CLAUDE.md, non-negotiable constraint 2.
 *
 * So this shares the artifact instead of transmitting it:
 *
 *   1. On a phone, the OS share sheet with the ACTUAL IMAGE FILES attached
 *      (`navigator.share({files})`). The user picks WhatsApp, and then any contact
 *      or group they like — or Gmail, or AirDrop, or Drive. This is the path that
 *      genuinely means "to anyone", and it is what a salesperson on the floor will
 *      use.
 *   2. Where that is unavailable (most desktop browsers), the signed links are
 *      copied to the clipboard to paste anywhere.
 *
 * Both share the same 7-day signed links the API recorded in the audit log. A
 * multi-page card shares every page — the older "Open" button only ever showed the
 * first one.
 */
export default function ShareJobCardButton({
  source,
  entityId,
  docLabel,
}: {
  source: JobCardSource;
  entityId: string;
  /** Human label for the share text, e.g. "ORD-2627-0007". */
  docLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * Try the OS share sheet with the files attached. Returns false when this
   * browser cannot do it, so the caller falls back to copying links.
   *
   * Every failure mode here is "fall back", never "throw": the user asked to share
   * something and must end up with a way to do it.
   */
  async function shareFiles(pages: { url: string; filename: string }[]): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.canShare || !navigator.share) return false;

    let files: File[];
    try {
      files = await Promise.all(
        pages.map(async (page) => {
          const resp = await fetch(page.url);
          if (!resp.ok) throw new Error(`page fetch failed (${resp.status})`);
          const blob = await resp.blob();
          return new File([blob], page.filename, { type: blob.type || "image/jpeg" });
        }),
      );
    } catch {
      return false; // couldn't fetch the bytes — copying the link still works
    }

    if (!navigator.canShare({ files })) return false;
    try {
      await navigator.share({
        files,
        title: docLabel ? `Job card ${docLabel}` : "Job card",
        text: docLabel
          ? `Job card ${docLabel} — Topaz Furniture. Specifications only, no prices.`
          : "Job card — Topaz Furniture. Specifications only, no prices.",
      });
      return true;
    } catch (err) {
      // AbortError = the user closed the sheet. That is a completed interaction,
      // not a failure, and must NOT fall through to copying a link they did not ask
      // for.
      if (err instanceof Error && err.name === "AbortError") return true;
      return false;
    }
  }

  async function copyLinks(pages: { url: string }[]): Promise<boolean> {
    const text = pages.map((p) => p.url).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function share() {
    setBusy(true);
    setError(null);
    setNotice(null);

    startTransition(async () => {
      try {
        const result = await getJobCardShare(source, entityId);
        if (result.error || !result.pages?.length) {
          setError(result.error ?? "No job card pages to share.");
          return;
        }
        const pages = result.pages;
        const days = Math.round((result.expiresIn ?? 0) / 86_400);

        if (result.format === "image" && (await shareFiles(pages))) return;

        if (await copyLinks(pages)) {
          setNotice(
            `${pages.length === 1 ? "Link" : `${pages.length} page links`} copied — ` +
              `paste anywhere. Valid ${days} day${days === 1 ? "" : "s"}.`,
          );
          return;
        }
        // Clipboard blocked too (insecure context / permissions). Opening the pages
        // at least puts them somewhere the user can copy from by hand.
        pages.forEach((p) => window.open(p.url, "_blank", "noopener,noreferrer"));
        setNotice("Opened in new tabs — copy the address to share.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not share the job card.");
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        disabled={busy || isPending}
        onClick={share}
        title="Share the spec sheet with anyone — WhatsApp, email, or a copied link"
      >
        <Share2 className="w-3.5 h-3.5" strokeWidth={2} />
        <span>{busy ? "Preparing…" : "Share"}</span>
      </Button>
      {error && <span className="text-[11px] text-warn">{error}</span>}
      {notice && <span className="text-[11px] text-t3">{notice}</span>}
    </>
  );
}
