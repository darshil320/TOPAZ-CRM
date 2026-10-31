import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSalesperson } from "@/lib/auth";
import ScannerClient from "./ScannerClient";

export const metadata: Metadata = {
  title: "Scan product · Topaz CRM",
  robots: { index: false, follow: false },
};

/**
 * Staff QR scanner. Outside the AppShell on purpose: the camera gets the whole screen,
 * and every role — including workshop and delivery, who live in their own PWAs — can
 * open it. A customer never needs this page: their phone camera opens /p/<code>.
 */
export default async function ScanPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  return <ScannerClient />;
}
