import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-slate-50 text-slate-900 font-sans antialiased">{children}</body>
    </html>
  );
}
