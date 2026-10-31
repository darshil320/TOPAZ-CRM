"use client";

/**
 * Full-screen QR scanner. The camera surface is black/white regardless of theme —
 * overlay text sits on live video, not on a design-system surface.
 *
 * On a Topaz sticker: haptic tick, the camera is released immediately (the LED goes
 * out), and we navigate to /p/<code>, which renders the staff view for a signed-in
 * user. A foreign QR (Wi-Fi, a payment code) shows a brief hint and scanning carries
 * on — it is never opened.
 */
import { useCallback, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flashlight, FlashlightOff, Loader2, RotateCcw, X } from "lucide-react";
import { useQrScanner } from "@/lib/scan/useQrScanner";
import { extractProductCode, normalizeProductCode, productPath } from "@/lib/scan/productCode";

const FOREIGN_HINT_MS = 2_000;
const HAPTIC_MS = 40;

export default function ScannerClient() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const open = useCallback(
    (code: string) => {
      setOpening(code);
      // Browsers refuse vibrate() before the first tap (and log a warning); a scan
      // opened straight from the nav has usually had one.
      if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) {
        navigator.vibrate?.(HAPTIC_MS);
      }
      router.push(productPath(code));
    },
    [router],
  );

  const onDecode = useCallback(
    (text: string) => {
      const code = extractProductCode(text);
      if (code) {
        open(code);
        return true;
      }
      setHint("That QR is not a Topaz product tag");
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(null), FOREIGN_HINT_MS);
      return false;
    },
    [open],
  );

  const { status, torch, setTorch } = useQrScanner(videoRef, onDecode, attempt);

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeProductCode(manual);
    if (!code) {
      setManualError("Codes are 8 letters/digits, e.g. 7K3M9QXA");
      return;
    }
    setManualError(null);
    open(code);
  };

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col select-none">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        autoPlay
        aria-label="Camera preview"
      />

      {/* Viewfinder: the decoder reads the centre square, so aim it there. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative h-[68vmin] w-[68vmin] rounded-shell shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]">
          <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-shell border-l-4 border-t-4 border-white" />
          <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-shell border-r-4 border-t-4 border-white" />
          <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-shell border-b-4 border-l-4 border-white" />
          <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-shell border-b-4 border-r-4 border-white" />
        </div>
      </div>

      <header className="relative z-10 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Link
          href="/dashboard/products"
          aria-label="Close scanner"
          className="flex h-10 w-10 items-center justify-center rounded-pill bg-white/15 backdrop-blur"
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </Link>
        <p className="text-ui font-semibold">Scan product tag</p>
        {torch.supported ? (
          <button
            type="button"
            onClick={() => void setTorch(!torch.on)}
            aria-label={torch.on ? "Turn torch off" : "Turn torch on"}
            aria-pressed={torch.on}
            className="flex h-10 w-10 items-center justify-center rounded-pill bg-white/15 backdrop-blur"
          >
            {torch.on ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
          </button>
        ) : (
          <span className="h-10 w-10" />
        )}
      </header>

      <div className="relative z-10 mt-auto space-y-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <StatusLine status={status.kind} opening={opening} hint={hint} />

        {status.kind === "error" && (
          <div className="rounded-card bg-white/95 p-3 text-caption text-black">
            <p>{status.message}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-2 inline-flex items-center gap-1.5 font-semibold"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        )}

        <form onSubmit={submitManual} className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Or type the code on the sticker"
            aria-label="Product code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border-0 bg-white/15 px-3 py-2.5 font-mono text-ui uppercase tracking-wider text-white placeholder:normal-case placeholder:tracking-normal placeholder:text-white/60 backdrop-blur focus:ring-2 focus:ring-white/60"
          />
          <button type="submit" className="rounded-md bg-white px-4 text-ui font-semibold text-black">
            Open
          </button>
        </form>
        {manualError && <p className="text-caption text-white/80">{manualError}</p>}
      </div>
    </div>
  );
}

function StatusLine({
  status,
  opening,
  hint,
}: {
  status: "starting" | "scanning" | "done" | "error";
  opening: string | null;
  hint: string | null;
}) {
  if (status === "error") return null;
  const text = opening
    ? `Opening ${opening}…`
    : hint ?? (status === "starting" ? "Starting camera…" : "Point at the QR sticker");
  const busy = opening !== null || status === "starting";
  return (
    <p
      role="status"
      aria-live="polite"
      className="mx-auto flex w-fit items-center gap-2 rounded-pill bg-black/60 px-3 py-1.5 text-caption font-semibold backdrop-blur"
    >
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {text}
    </p>
  );
}
