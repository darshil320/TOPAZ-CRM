import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The QR scanner's WebAssembly decoder (scripts/copy-zxing-wasm.mjs). Its file name
  // carries the zxing-wasm version, so it can be cached forever: after the first scan
  // on a phone, opening the scanner costs no network at all.
  async headers() {
    return [
      {
        source: "/zxing/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        // Vercel preview + production domains
        "*.vercel.app",
        "topaz-crm.vercel.app",
        "topaz-showroom-intelligence.vercel.app",
      ],
    },
  },
};

export default nextConfig;

