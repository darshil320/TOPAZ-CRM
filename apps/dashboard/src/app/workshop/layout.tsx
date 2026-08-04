import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentSalesperson } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sparkles, Hammer, LogOut, ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Topaz Workshop PWA",
  description: "Mobile-first production stage management for Topaz workshops",
};

export default async function WorkshopLayout({ children }: { children: React.ReactNode }) {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Mobile Top App Bar */}
      {/* Fixed h-16: the queue's sticky filter bar pins to `top-16`, so this
          height is a contract, not a coincidence. */}
      <header className="sticky top-0 z-40 h-16 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-amber-500/20">
              <Hammer className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
                Topaz Workshop <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">PWA</span>
              </h1>
              <p className="text-[11px] text-slate-400 font-medium">
                {sp.name} <span className="text-slate-500">· {sp.role}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/dashboard/production" className="text-xs font-semibold text-amber-400 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 px-3 py-1.5 rounded-md transition-all">
            Live Board
          </Link>
        </div>
      </header>

      {/* Main App Container */}
      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 pb-24">
        {children}
      </main>

      {/* Fixed Footer Note */}
      <footer className="py-4 text-center text-slate-500 text-xs border-t border-slate-900 bg-slate-950">
        Topaz Showroom Intelligence · Workshop Production System
      </footer>
    </div>
  );
}
