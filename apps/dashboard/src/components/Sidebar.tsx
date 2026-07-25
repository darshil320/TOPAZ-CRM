"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ICON_SIZE,
  isActive,
  OWNER_NAV,
  SALES_NAV,
  type NavItem,
  type Role,
} from "./nav-config";

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item, pathname);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
        active
          ? "bg-blue-600/10 text-blue-400 border-l-2 border-blue-500 shadow-sm"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
      }`}
    >
      <span className={`${ICON_SIZE} shrink-0 flex items-center justify-center transition-transform group-hover:scale-110`}>
        {item.icon(`${ICON_SIZE} ${active ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`)}
      </span>
      <span className="whitespace-nowrap tracking-tight">{item.label}</span>
    </Link>
  );
}

export default function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <aside className="hidden sm:flex sticky top-0 h-screen w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950 text-slate-200 shadow-xl z-50">
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800/80 bg-slate-950/50">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold text-white text-sm tracking-tight group-hover:text-blue-400 transition-colors">
              Topaz CRM
            </span>
            <span className="text-[9px] font-semibold text-slate-500 tracking-wider uppercase">
              Showroom Intelligence
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3.5 py-5 space-y-6 overflow-y-auto scrollbar-thin">
        {role === "owner" ? (
          <>
            <div>
              <p className="px-3.5 mb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Owner Control
              </p>
              <div className="space-y-1">
                {OWNER_NAV.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            </div>
            <div>
              <p className="px-3.5 mb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Sales Workspace
              </p>
              <div className="space-y-1">
                {SALES_NAV.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <p className="px-3.5 mb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Sales Workspace
            </p>
            {SALES_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        )}
      </nav>

      {/* Footer Role Badge */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold text-slate-400">Status</span>
        </div>

        <span
          className={`text-[10px] font-extrabold px-2.5 py-1 rounded-md tracking-wider uppercase shadow-sm ${
            role === "owner"
              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
          }`}
        >
          {role === "owner" ? "Owner" : "Salesperson"}
        </span>
      </div>
    </aside>
  );
}
