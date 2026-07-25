"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, navForRole, type NavItem, type Role } from "./nav-config";

// ─── "More" sheet icon ──────────────────────────────────────────────────────
function MoreIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

// How many items to show in the bar before folding into "More"
const PRIMARY_COUNT = 4;

interface TabProps {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
}
function Tab({ item, active, onClick }: TabProps) {
  const cls = `flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] py-2 px-1 text-[10px] font-semibold transition-colors active:scale-95 ${
    active ? "text-blue-600" : "text-slate-500"
  }`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} aria-label={item.label}>
        <span className="w-6 h-6 flex items-center justify-center">
          {item.icon(`w-5 h-5 ${active ? "text-blue-600" : "text-slate-400"}`)}
        </span>
        <span className="leading-none truncate w-full text-center">{item.shortLabel}</span>
      </button>
    );
  }
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={cls}>
      <span className="w-6 h-6 flex items-center justify-center">
        {item.icon(`w-5 h-5 ${active ? "text-blue-600" : "text-slate-400"}`)}
      </span>
      <span className="leading-none truncate w-full text-center">{item.shortLabel}</span>
    </Link>
  );
}

/**
 * Bottom tab bar for phones.
 * - Up to PRIMARY_COUNT (4) items shown directly in the bar.
 * - If the role has more items, the 4th slot becomes a "More" button that
 *   opens a slide-up sheet listing the overflow items.
 * - Fixed to the bottom; honours iOS home-indicator safe area.
 */
export default function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const all = navForRole(role);

  const hasMore = all.length > PRIMARY_COUNT;
  const primary = hasMore ? all.slice(0, PRIMARY_COUNT - 1) : all;
  const overflow = hasMore ? all.slice(PRIMARY_COUNT - 1) : [];

  // Is any overflow item active?
  const overflowActive = overflow.some((i) => isActive(i, pathname));

  return (
    <>
      {/* Bottom bar */}
      <nav
        aria-label="Primary navigation"
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-stretch">
          {primary.map((item) => (
            <Tab key={item.href} item={item} active={isActive(item, pathname)} />
          ))}

          {hasMore && (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="More navigation options"
              aria-expanded={sheetOpen}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] py-2 px-1 text-[10px] font-semibold transition-colors active:scale-95 ${
                overflowActive ? "text-blue-600" : "text-slate-500"
              }`}
            >
              <span className="w-6 h-6 flex items-center justify-center">
                <MoreIcon className={`w-5 h-5 ${overflowActive ? "text-blue-600" : "text-slate-400"}`} />
              </span>
              <span className="leading-none">More</span>
            </button>
          )}
        </div>
      </nav>

      {/* Slide-up sheet (overflow items) */}
      {hasMore && (
        <>
          {/* Backdrop */}
          {sheetOpen && (
            <div
              className="sm:hidden fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
              onClick={() => setSheetOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Sheet */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            className={`sm:hidden fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-in-out pb-[env(safe-area-inset-bottom)] ${
              sheetOpen ? "translate-y-0" : "translate-y-full"
            }`}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-300" />
            </div>
            <p className="px-5 pb-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">More</p>
            <ul className="px-3 pb-4 space-y-1">
              {overflow.map((item) => {
                const active = isActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setSheetOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                        active
                          ? "bg-blue-50 text-blue-700"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span className="w-5 h-5 flex items-center justify-center shrink-0">
                        {item.icon(`w-5 h-5 ${active ? "text-blue-600" : "text-slate-400"}`)}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
