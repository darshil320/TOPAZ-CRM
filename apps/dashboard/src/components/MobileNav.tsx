"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, navForRole, type Role } from "./nav-config";

/**
 * Bottom tab bar for phones. Replaces the desktop Sidebar (which is
 * `hidden sm:flex`) so mobile users can actually navigate. Fixed to the bottom
 * where thumbs reach; honours the iOS home-indicator safe area.
 */
export default function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = navForRole(role);

  return (
    <nav
      aria-label="Primary"
      className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-stretch justify-around">
        {items.map((item) => {
          const active = isActive(item, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-1 min-h-[56px] py-2 text-[11px] font-medium transition-colors active:bg-slate-50 ${
                active ? "text-blue-600" : "text-slate-500"
              }`}
            >
              <span className="w-6 h-6 flex items-center justify-center">
                {item.icon(`w-6 h-6 ${active ? "text-blue-600" : "text-slate-400"}`)}
              </span>
              <span className="leading-none">{item.shortLabel}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
