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
      className={`group relative flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 ${
        active
          ? "bg-gradient-to-r from-blue-600/20 via-indigo-600/10 to-transparent text-white font-bold shadow-xs border-l-[3px] border-blue-500 pl-3"
          : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-100"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`${ICON_SIZE} shrink-0 flex items-center justify-center transition-all group-hover:scale-110 ${
            active ? "text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]" : "text-slate-400 group-hover:text-slate-200"
          }`}
        >
          {item.icon(`${ICON_SIZE}`)}
        </span>
        <span className="truncate tracking-tight">{item.label}</span>
      </div>

      {active && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_#60a5fa] shrink-0" />
      )}
    </Link>
  );
}

export default function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <aside className="hidden sm:flex sticky top-0 h-screen w-64 shrink-0 flex-col border-r border-slate-800/80 bg-[#090D16] text-slate-300 shadow-2xl z-50 select-none">
      {/* Brand Header & Workspace Switcher */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/60 bg-[#060910]">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-500 p-0.5 shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/35 transition-all">
              <div className="w-full h-full bg-[#090D16] rounded-[10px] flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-400 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
            </div>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-white text-sm tracking-tight group-hover:text-blue-400 transition-colors">
                Topaz CRM
              </span>
              <span className="text-[9px] font-extrabold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.2 rounded-md">
                PRO
              </span>
            </div>
            <span className="text-[9px] font-semibold text-slate-500 tracking-widest uppercase">
              Showroom Intelligence
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 px-3 py-5 space-y-6 overflow-y-auto scrollbar-none">
        {role === "owner" ? (
          <>
            <div>
              <div className="px-3.5 mb-2.5 flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">
                  Management Overview
                </span>
              </div>
              <div className="space-y-1">
                {OWNER_NAV.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            </div>

            <div>
              <div className="px-3.5 mb-2.5 flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">
                  Sales Engine
                </span>
              </div>
              <div className="space-y-1">
                {SALES_NAV.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <div className="px-3.5 mb-2.5 flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">
                Sales Workspace
              </span>
            </div>
            {SALES_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        )}
      </nav>

      {/* Footer Profile Card */}
      <div className="p-3 border-t border-slate-800/80 bg-[#060910]/90">
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-2.5 flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white font-extrabold text-xs shadow-sm">
                {role === "owner" ? "O" : "S"}
              </div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#090D16]" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-slate-200 truncate capitalize leading-tight">
                {role} Mode
              </span>
              <span className="text-[10px] text-slate-500 truncate font-medium">
                Connected to Cloud
              </span>
            </div>
          </div>

          <span
            className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider ${
              role === "owner"
                ? "bg-amber-400/10 text-amber-400 border border-amber-500/20"
                : "bg-blue-400/10 text-blue-400 border border-blue-500/20"
            }`}
          >
            {role}
          </span>
        </div>
      </div>
    </aside>
  );
}
