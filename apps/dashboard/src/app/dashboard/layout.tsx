import type { ReactNode } from "react";
import { redirect } from "next/navigation";
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
    <div className="flex min-h-screen w-full bg-slate-50 font-sans text-slate-900 antialiased">
      <Sidebar role={role} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar */}
        <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
          <div className="px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
            <MobileBrand />

            {/* Quick Search Placeholder (Desktop) */}
            <div className="hidden md:flex items-center gap-2 bg-slate-100/80 border border-slate-200/80 rounded-xl px-3.5 py-1.5 w-72 text-slate-400 focus-within:border-blue-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-xs text-slate-400 font-medium">Quick search...</span>
              <kbd className="ml-auto text-[10px] font-bold text-slate-400 bg-white border border-slate-200 rounded px-1.5 py-0.5 shadow-2xs">⌘K</kbd>
            </div>

            {/* User Controls */}
            <div className="flex items-center gap-3.5 ml-auto">
              <div className="hidden sm:flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                  {initials}
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-900 leading-tight">{salesperson.name}</span>
                  <span className="text-[10px] text-slate-500 font-medium capitalize">{role}</span>
                </div>
              </div>

              <div className="w-px h-5 bg-slate-200 hidden sm:block" />

              <AvailabilityToggle
                salespersonId={salesperson.id}
                initialAvailable={salesperson.available ?? false}
              />

              <SignOutButton />
            </div>
          </div>
        </header>

        <VisitAlertBanner salespersonId={salesperson.id} />

        {/* Main Content Area */}
        <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-8 pb-24 sm:pb-8">{children}</main>
      </div>

      <MobileNav role={role} />
    </div>
  );
}
