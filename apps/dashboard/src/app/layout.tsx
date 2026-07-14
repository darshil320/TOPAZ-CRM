import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Topaz CRM",
  description: "Showroom intelligence dashboard",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // `cover` is required for the env(safe-area-inset-*) padding on the mobile
  // bottom nav to take effect on notched / home-indicator devices.
  viewportFit: "cover",
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
