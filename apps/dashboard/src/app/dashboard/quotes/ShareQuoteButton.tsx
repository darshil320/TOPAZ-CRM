"use client";

/**
 * Share a quotation — WITH its prices — with anyone: the customer's architect, a
 * relative, a second number. Same approach as ShareJobCardButton, for the same reason:
 * a WhatsApp send to an arbitrary number fails outside the 24-hour window (CLAUDE.md,
 * constraint 2), so this shares the artifact through the phone's own share sheet.
 *
 * Shares the PDF, NOT the /q/{token} customer link: that page carries Approve/Reject,
 * and a forwarded quotation must not hand a third party the customer's approval.
 *
 *   1. Prepare — GET the current PDF; if there is none (never rendered, or the draft was
 *      edited since), queue a render and poll. Rendering is a worker job (seconds).
 *   2. Share sheet with the PDF FILE attached (`navigator.share({files})`), else its link.
 *      Browsers only allow share() straight after a tap; when the prepare wait outlived
 *      it (typical on iPhone) the button turns into "Share PDF" and the second tap
 *      shares with nothing awaited in front of it.
 *   3. No share sheet (most desktops): the signed link is copied; if the clipboard is
 *      blocked too, an "Open PDF" link is shown.
 */

import { useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { getQuotePdfAction, renderQuotePdfAction, type QuotePdfResult } from "./shareActions";

// ~15s of polling — same budget as ChallanButton: a cold Playwright start fits, a dead
// worker does not spin the button forever.
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 1500;
const SECONDS_PER_DAY = 86_400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Prepared {
  url: string;
  /** Null when the bytes could not be fetched; the share then carries the link. */
  file: File | null;
  /** Lifetime of `url`, for the notices. */
  days: number;
}

type Outcome = "shared" | "cancelled" | "needs-tap" | "unsupported";

const daysLabel = (days: number) => `${days} day${days === 1 ? "" : "s"}`;

async function fetchAsFile(url: string, filename: string): Promise<File | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return new File([await resp.blob()], filename, { type: "application/pdf" });
  } catch {
    return null; // the link still works — the caller says so to the user
  }
}

/** The current PDF, rendering one first if needed. Only a 404 means "keep waiting". */
async function waitForPdf(quoteId: string): Promise<QuotePdfResult> {
  let ready = await getQuotePdfAction(quoteId);
  if (ready.url || !ready.notReady) return ready;
  const queued = await renderQuotePdfAction(quoteId);
  if (queued.error) return { error: queued.error };
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    ready = await getQuotePdfAction(quoteId);
    if (ready.url || !ready.notReady) return ready;
  }
  return { error: "Still preparing the PDF — tap Share again in a moment." };
}

async function prepare(quoteId: string, quoteNo: string): Promise<Prepared | string> {
  const ready = await waitForPdf(quoteId);
  if (!ready.url) return ready.error ?? "Could not get the quotation PDF.";
  const file = await fetchAsFile(ready.url, ready.filename ?? `${quoteNo}.pdf`);
  const days = Math.max(1, Math.round((ready.expiresIn ?? 0) / SECONDS_PER_DAY));
  return { url: ready.url, file, days };
}

/** Invokes navigator.share() before any await, so a fresh tap's activation reaches it. */
async function shareSheet(p: Prepared, quoteNo: string): Promise<Outcome> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return "unsupported";
  }
  const text = `Quotation ${quoteNo} from Topaz Furniture`;
  const data: ShareData =
    p.file && navigator.canShare?.({ files: [p.file] })
      ? { files: [p.file], title: text, text }
      : { title: text, text, url: p.url };
  try {
    await navigator.share(data);
    return "shared";
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    // AbortError = the user closed the sheet: a finished interaction, not a failure.
    if (name === "AbortError") return "cancelled";
    if (name === "NotAllowedError") return "needs-tap";
    return "unsupported";
  }
}

export default function ShareQuoteButton({ quoteId, quoteNo }: { quoteId: string; quoteNo: string }) {
  const [busy, setBusy] = useState(false);
  // Held only after a "needs-tap", so the second tap can share immediately.
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copyLink(p: Prepared) {
    try {
      await navigator.clipboard.writeText(p.url);
      setNotice(`Link copied — paste it anywhere. Valid ${daysLabel(p.days)}.`);
    } catch {
      setOpenUrl(p.url);
      setNotice("Open the PDF and copy its address to share it.");
    }
  }

  async function deliver(p: Prepared) {
    const outcome = await shareSheet(p, quoteNo);
    if (outcome === "needs-tap") {
      setPrepared(p);
      setNotice("PDF ready — tap Share PDF to send it.");
      return;
    }
    setPrepared(null);
    if (outcome === "unsupported") {
      await copyLink(p);
    } else if (outcome === "shared" && !p.file) {
      setNotice(`The PDF file could not be attached, so its link was shared (valid ${daysLabel(p.days)}).`);
    }
  }

  async function handleClick() {
    setError(null);
    setNotice(null);
    setOpenUrl(null);
    if (prepared) {
      await deliver(prepared);
      return;
    }
    setBusy(true);
    try {
      const result = await prepare(quoteId, quoteNo);
      if (typeof result === "string") setError(result);
      else await deliver(result);
    } catch {
      setError("Could not share the quotation — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant="secondary"
        onClick={handleClick}
        disabled={busy}
        title="Share the quotation PDF, with prices, with anyone — WhatsApp, email, or a copied link"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Share2 className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        <span>{busy ? "Preparing PDF…" : prepared ? "Share PDF" : "Share"}</span>
      </Button>
      {openUrl && (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-caption font-semibold text-acc hover:underline"
        >
          Open PDF
        </a>
      )}
      {notice && <p className="text-caption text-t3">{notice}</p>}
      {error && <p className="text-caption text-warn">{error}</p>}
    </div>
  );
}
