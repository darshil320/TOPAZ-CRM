import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentSalesperson } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Truck, ArrowLeft, LogOut } from "lucide-react";

export const metadata: Metadata = {
  title: "Topaz Delivery PWA",
  description: "Mobile-first delivery & installation proof app for Topaz drivers",
};

export default async function DeliveryLayout({ children }: { children: React.ReactNode }) {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Mobile Top App Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-emerald-500/20">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
                Topaz Delivery <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">PWA</span>
              </h1>
              <p className="text-[11px] text-slate-400 font-medium">
                {sp.name} <span className="text-slate-500">· {sp.role}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/dashboard/deliveries" className="text-xs font-semibold text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 border border-emerald-400/30 px-3 py-1.5 rounded-md transition-all">
            Schedule View
          </Link>
        </div>
      </header>

      {/* Main App Container */}
      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 pb-24">
        {children}
      </main>

      <footer className="py-4 text-center text-slate-500 text-xs border-t border-slate-900 bg-slate-950">
        Topaz Showroom Intelligence · Delivery & Installation Proof
      </footer>
    </div>
  );
}
