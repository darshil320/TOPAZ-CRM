/**
 * QR decoding off the main thread — ZXing-C++ compiled to WebAssembly (zxing-wasm).
 *
 * Why a worker: decoding a frame takes a few to ~20 ms on a mid-range phone. On the
 * main thread that is dropped preview frames and a jittery viewfinder; here the
 * camera preview stays at full frame rate while frames are decoded back-to-back.
 *
 * Protocol (lib/scan/useQrScanner.ts is the only client):
 *   in : { type: "decode", id, width, height, buffer }   RGBA pixels, transferred
 *   out: { type: "ready" }                                 wasm compiled, send frames
 *        { type: "result", id, text }                      text = null ⇒ nothing found
 *        { type: "fatal", message }                        the decoder cannot start
 */
import { prepareZXingModule, readBarcodes, ZXING_WASM_VERSION, type ReaderOptions } from "zxing-wasm/reader";

interface DecodeMessage {
  type: "decode";
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

// The project compiles against the DOM lib (adding the webworker lib alongside it
// conflicts), so the worker scope is typed by what this file actually uses.
const scope = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent<DecodeMessage>) => void) | null;
  location: { origin: string };
};

// Tuned for "one QR sticker, held in front of the camera":
//   - QRCode only: skipping the 1D/other 2D detectors is the single biggest speed-up.
//   - tryRotate off: QR finder patterns are rotation-invariant; the extra passes only
//     help linear barcodes.
//   - tryInvert off: our stickers are always dark-on-light.
//   - tryHarder + tryDownscale on: catches small, distant or close-up stickers.
//   - maxNumberOfSymbols 1: stop at the first hit.
const READER_OPTIONS: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

// Self-hosted (scripts/copy-zxing-wasm.mjs), versioned so it is cached immutably.
const WASM_PATH = `/zxing/zxing_reader-${ZXING_WASM_VERSION}.wasm`;

const ready = prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? new URL(WASM_PATH, scope.location.origin).href : prefix + path,
  },
  fireImmediately: true,
});

ready.then(
  () => scope.postMessage({ type: "ready" }),
  (err: unknown) =>
    scope.postMessage({ type: "fatal", message: err instanceof Error ? err.message : String(err) }),
);

scope.onmessage = async (event: MessageEvent<DecodeMessage>) => {
  const msg = event.data;
  if (msg?.type !== "decode") return;
  try {
    await ready;
    const image = new ImageData(new Uint8ClampedArray(msg.buffer), msg.width, msg.height);
    const results = await readBarcodes(image, READER_OPTIONS);
    const hit = results.find((r) => r.isValid && r.text);
    scope.postMessage({ type: "result", id: msg.id, text: hit?.text ?? null });
  } catch {
    // A bad frame is not fatal — report "nothing found" and let the next frame try.
    scope.postMessage({ type: "result", id: msg.id, text: null });
  }
};
