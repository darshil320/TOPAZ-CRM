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
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <span className={`${ICON_SIZE} shrink-0 flex items-center justify-center`}>
        {item.icon(`${ICON_SIZE} ${active ? "text-blue-600" : "text-slate-400"}`)}
      </span>
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  );
}

export default function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <aside className="hidden sm:flex sticky top-0 h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="h-14 flex items-center gap-2.5 px-5 border-b border-slate-200">
        <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </div>
        <span className="font-semibold text-slate-900 text-sm tracking-tight">Topaz CRM</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
        {role === "owner" ? (
          <>
            <div>
              <p className="px-3 mb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Owner</p>
              <div className="space-y-1">
                {OWNER_NAV.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            </div>
            <div>
              <p className="px-3 mb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Sales view</p>
              <div className="space-y-1">
                {SALES_NAV.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-1">
            {SALES_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        )}
      </nav>

      <div className="px-5 py-3 border-t border-slate-200">
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            role === "owner" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
          }`}
        >
          {role === "owner" ? "Owner" : "Salesperson"}
        </span>
      </div>
    </aside>
  );
}
