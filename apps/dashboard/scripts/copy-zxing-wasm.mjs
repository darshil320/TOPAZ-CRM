/**
 * Self-host the ZXing-C++ WebAssembly reader used by the QR scanner (/scan).
 *
 * zxing-wasm fetches its .wasm from the jsDelivr CDN unless told otherwise. On a
 * showroom phone that is a third-party DNS lookup + TLS handshake before the first
 * frame can be decoded, and a hard failure when the CDN is slow or blocked. Serving
 * it from our own origin, under a VERSIONED name, lets it be cached as immutable
 * (next.config.ts headers) — after the first visit, the scanner starts with zero
 * network.
 *
 * The file name embeds the package version so the JS glue and the binary can never
 * mismatch: a zxing-wasm upgrade writes a new file and the scanner asks for it by
 * the new name (lib/scan/zxing.ts reads ZXING_WASM_VERSION at runtime).
 *
 * Runs on postinstall and before `next build`; idempotent. Output is gitignored.
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const wasm = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
const pkgJson = join(dirname(wasm), "..", "..", "package.json");
const { version } = JSON.parse(readFileSync(pkgJson, "utf8"));

const outDir = join(root, "public", "zxing");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `zxing_reader-${version}.wasm`);
copyFileSync(wasm, out);
process.stdout.write(`[zxing] ${out}\n`);
