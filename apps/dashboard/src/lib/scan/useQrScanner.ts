"use client";

/**
 * Camera → QR text, as fast as the phone allows.
 *
 * What makes it fast (each one measurable on a mid-range Android):
 *  1. Decoding runs in a Web Worker (qrDecoder.worker.ts) on ZXing-C++/WASM — the
 *     preview never stutters, and the C++ decoder is several times quicker than the
 *     pure-JS ZXing port.
 *  2. The worker and the camera start IN PARALLEL on mount: the ~1 MB decoder
 *     compiles while the user is still answering the camera prompt (and it is cached
 *     immutably afterwards, so a second visit starts with no network at all).
 *  3. Only the centre square of each frame is decoded, downscaled to at most
 *     DECODE_EDGE_PX — fewer pixels, same sticker.
 *  4. Back-pressure, not a timer: the next frame goes to the worker the moment the
 *     previous one is done (requestVideoFrameCallback where available), so the
 *     decoder is never idle and never queued up behind stale frames.
 *  5. Pixels are TRANSFERRED to the worker (zero-copy), not cloned.
 *  6. Continuous autofocus is requested when the camera supports it, and a torch
 *     toggle is offered for dim godowns.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Centre square decoded each frame, as a fraction of the frame's short side. */
const ROI_FRACTION = 0.8;
/** Longest edge of the decoded crop. ZXing locates a sticker in ~700 px easily. */
const DECODE_EDGE_PX = 720;
/** A decode that has not answered in this long is presumed lost; send a fresh frame. */
const WORKER_STALL_MS = 1_500;

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

export type ScannerStatus =
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "done" }
  | { kind: "error"; message: string };

interface Frame {
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

/** Torch / focus are not in the DOM lib's constraint types yet. */
type ExtendedCapabilities = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
type ExtendedConstraintSet = MediaTrackConstraintSet & { torch?: boolean; focusMode?: string };

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is blocked. Allow the camera for this site in your browser settings, then reload.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No usable camera was found on this device.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera is busy in another app. Close that app and tap Retry.";
  }
  return "The camera could not be opened. Tap Retry, or type the code below.";
}

/** Draw the centre square of the current video frame and read its pixels. */
function grabFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): Frame | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const side = Math.floor(Math.min(vw, vh) * ROI_FRACTION);
  const out = Math.min(side, DECODE_EDGE_PX);
  if (canvas.width !== out) canvas.width = out;
  if (canvas.height !== out) canvas.height = out;
  ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, out, out);
  const image = ctx.getImageData(0, 0, out, out);
  return { width: out, height: out, buffer: image.data.buffer };
}

/**
 * Start the camera on `videoRef` and decode until `onDecode` accepts a text (returns
 * true). Rejected texts (a foreign QR) keep the scanner running. `attempt` restarts
 * everything when bumped (the Retry button).
 */
export function useQrScanner(
  videoRef: RefObject<HTMLVideoElement | null>,
  onDecode: (text: string) => boolean,
  attempt = 0,
) {
  const [status, setStatus] = useState<ScannerStatus>({ kind: "starting" });
  const [torch, setTorchState] = useState({ supported: false, on: false });
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let finished = false;
    let stream: MediaStream | null = null;
    let workerReady = false;
    let busySince = 0;
    let nextId = 0;
    let rafHandle = 0;
    let vfcHandle = 0;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const worker = new Worker(new URL("./qrDecoder.worker.ts", import.meta.url), { type: "module" });

    const releaseCamera = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      trackRef.current = null;
      if (video.srcObject) video.srcObject = null;
    };

    const finish = () => {
      finished = true;
      releaseCamera();
      worker.terminate();
      setStatus({ kind: "done" });
    };

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as { type: string; text?: string | null };
      if (msg.type === "ready") {
        workerReady = true;
      } else if (msg.type === "fatal") {
        if (!cancelled) {
          setStatus({ kind: "error", message: "The scanner failed to load. Check your connection and tap Retry." });
        }
      } else if (msg.type === "result") {
        busySince = 0;
        if (msg.text && !finished && !cancelled && onDecodeRef.current(msg.text)) finish();
      }
    };

    const schedule = () => {
      if (cancelled || finished) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        vfcHandle = video.requestVideoFrameCallback(tick);
      } else {
        rafHandle = requestAnimationFrame(tick);
      }
    };

    function tick() {
      if (cancelled || finished) return;
      const now = performance.now();
      const idle = busySince === 0 || now - busySince > WORKER_STALL_MS;
      if (ctx && workerReady && idle && video!.readyState >= 2 && !document.hidden) {
        const frame = grabFrame(video!, canvas, ctx);
        if (frame) {
          busySince = now;
          nextId += 1;
          worker.postMessage({ type: "decode", id: nextId, ...frame }, [frame.buffer]);
        }
      }
      schedule();
    }

    const tuneTrack = async (track: MediaStreamTrack) => {
      const caps = (track.getCapabilities?.() ?? {}) as ExtendedCapabilities;
      if (caps.focusMode?.includes("continuous")) {
        await track
          .applyConstraints({ advanced: [{ focusMode: "continuous" } as ExtendedConstraintSet] })
          .catch(() => undefined);
      }
      if (!cancelled) setTorchState({ supported: caps.torch === true, on: false });
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: "error", message: "This browser cannot open the camera here. Use Chrome or Safari over https." });
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      } catch (err) {
        if (!cancelled) setStatus({ kind: "error", message: cameraErrorMessage(err) });
        return;
      }
      if (cancelled) {
        releaseCamera();
        return;
      }
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // iOS may refuse autoplay until the element is visible; the frames still flow
        // once it is, and the loop below simply waits for readyState.
      }
      if (track) void tuneTrack(track);
      setStatus({ kind: "scanning" });
      schedule();
    };

    setStatus({ kind: "starting" });
    void start();

    return () => {
      cancelled = true;
      if (vfcHandle && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(vfcHandle);
      }
      if (rafHandle) cancelAnimationFrame(rafHandle);
      worker.terminate();
      releaseCamera();
    };
  }, [videoRef, attempt]);

  const setTorch = useCallback(async (on: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as ExtendedConstraintSet] });
      setTorchState({ supported: true, on });
    } catch {
      setTorchState({ supported: false, on: false });
    }
  }, []);

  return { status, torch, setTorch };
}
