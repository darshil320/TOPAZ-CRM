import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSalesperson } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";
import MobileBrand from "@/components/MobileBrand";
import VisitAlertBanner from "@/components/VisitAlertBanner";
import AvailabilityToggle from "@/components/AvailabilityToggle";
import SignOutButton from "@/components/SignOutButton";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const salesperson = await getCurrentSalesperson();
  if (!salesperson) redirect("/login");

  const initials = salesperson.name
    ? salesperson.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
    : "SP";

  const role = salesperson.role === "owner" ? "owner" : "salesperson";

  return (
    <div className="flex min-h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 antialiased selection:bg-blue-500 selection:text-white">
      <Sidebar role={role} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar */}
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
            <MobileBrand />

            {/* Desktop Breadcrumbs & Quick Search */}
            <div className="hidden md:flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <span className="text-slate-400">Workspace</span>
                <span className="text-slate-300">/</span>
                <span className="text-slate-800 font-bold capitalize">{role === "owner" ? "Owner Control" : "Sales Engine"}</span>
              </div>

              <div className="h-4 w-px bg-slate-200" />

              {/* Command Palette Search Box */}
              <div className="flex items-center gap-2 bg-slate-100/80 border border-slate-200/90 rounded-xl px-3 py-1.5 w-64 text-slate-400 focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/20 transition-all cursor-pointer">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span className="text-xs text-slate-400 font-medium">Search deals, quotes...</span>
                <kbd className="ml-auto text-[10px] font-extrabold text-slate-400 bg-white border border-slate-200 rounded px-1.5 py-0.5 shadow-2xs">⌘K</kbd>
              </div>
            </div>

            {/* Right Action Controls */}
            <div className="flex items-center gap-3.5 ml-auto">
              {/* Quick Action Button: New Quote */}
              <Link
                href="/dashboard/quotes/new"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold shadow-sm shadow-blue-500/20 active:scale-95 transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New Quote
              </Link>

              <div className="w-px h-5 bg-slate-200 hidden sm:block" />

              {/* User Profile Info */}
              <div className="hidden sm:flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center font-extrabold text-xs shadow-sm">
                  {initials}
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-900 leading-tight">{salesperson.name}</span>
                  <span className="text-[10px] text-slate-400 font-semibold capitalize">{role}</span>
                </div>
              </div>

              <AvailabilityToggle
                salespersonId={salesperson.id}
                initialAvailable={salesperson.available ?? false}
              />

              <SignOutButton />
            </div>
          </div>
        </header>

        <VisitAlertBanner salespersonId={salesperson.id} />

        {/* Main Workspace Canvas */}
        <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-8 pb-24 sm:pb-8">{children}</main>
      </div>

      <MobileNav role={role} />
    </div>
  );
}
