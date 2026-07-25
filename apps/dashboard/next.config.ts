import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

