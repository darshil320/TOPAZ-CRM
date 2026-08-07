"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Moon, Sun, LogOut, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getStoredTheme, toggleTheme, type Theme } from "@/lib/theme";
import { isActive, navForRole, type NavItem, type Role } from "./nav-config";
import type { AccountMenuUser } from "./shell/AccountMenu";

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
    active ? "text-acc" : "text-t3"
  }`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} aria-label={item.label}>
        <span className="w-6 h-6 flex items-center justify-center">
          {item.icon(`w-5 h-5 ${active ? "text-acc" : "text-t3"}`)}
        </span>
        <span className="leading-none truncate w-full text-center">{item.shortLabel}</span>
      </button>
    );
  }
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={cls}>
      <span className="w-6 h-6 flex items-center justify-center">
        {item.icon(`w-5 h-5 ${active ? "text-acc" : "text-t3"}`)}
      </span>
      <span className="leading-none truncate w-full text-center">{item.shortLabel}</span>
    </Link>
  );
}

export default function MobileNav({ role, user }: { role: Role; user?: AccountMenuUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>("light");
  const all = navForRole(role);

  useEffect(() => setThemeState(getStoredTheme()), []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

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
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-ln bg-sf/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
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
                overflowActive ? "text-acc" : "text-t3"
              }`}
            >
              <span className="w-6 h-6 flex items-center justify-center">
                <MoreIcon className={`w-5 h-5 ${overflowActive ? "text-acc" : "text-t3"}`} />
              </span>
              <span className="leading-none">More</span>
            </button>
          )}
        </div>
      </nav>

      {/* Slide-up sheet (overflow items + account controls) */}
      {hasMore && (
        <>
          {/* Backdrop */}
          {sheetOpen && (
            <div
              className="sm:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              onClick={() => setSheetOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Sheet */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            // `max-h-[90vh]` first as the floor for browsers without `dvh`
            // (iOS Safari < 15.4): there, `90dvh` is an invalid declaration and gets
            // dropped, leaving the sheet unbounded. `vh` is the large-viewport height
            // so it can slightly overshoot while the URL bar is showing — hence the
            // `dvh` override wherever it is understood, which is the accurate one.
            className={`sm:hidden fixed bottom-0 inset-x-0 z-50 bg-sf rounded-t-2xl shadow-shp border-t border-ln transition-transform duration-200 ease-out pb-[env(safe-area-inset-bottom)] flex flex-col max-h-[90vh] supports-[max-height:90dvh]:max-h-[90dvh] ${
              sheetOpen ? "translate-y-0" : "translate-y-full"
            }`}
          >
            {/* Handle and Close.
                A three-column grid, NOT an absolutely positioned button. The button
                used to be `absolute right-4 top-3`, which took it out of flow: the row
                was only 38px tall (pt-4 + a 6px handle + pb-2) while the button spans
                12→44px, so its bottom 6px hung over the scroll container below and the
                content scrolling past visually swallowed it. Measured as escaping its
                header on every phone size and text scale tried (320→430 wide, 16/20/24px
                root font). In a grid the row's height is driven by its tallest cell —
                the button — so the target cannot leave the header at any size. */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-3 pb-2 shrink-0">
              <span aria-hidden="true" />
              <div className="w-12 h-1.5 rounded-full bg-ln" />
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="justify-self-end w-8 h-8 flex items-center justify-center rounded-full bg-sf2 border border-ln text-t2 hover:bg-sf3 hover:text-t1 transition-all shadow-sm"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* `min-h-0` is flex hygiene, not the bug fix: a flex item defaults to
                `min-height: auto` and so refuses to shrink below its content. It is
                belt-and-braces for the sheet's max-height here (measured working
                without it too) and costs nothing. */}
            <div className="overflow-y-auto overscroll-contain flex-1 min-h-0">
              {user && (
              <div className="mx-4 mt-2 mb-3 p-3 rounded-card bg-sf2 border border-ln">
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-ln2 mb-2">
                  <span className="w-7 h-7 rounded-full bg-acc flex items-center justify-center text-white text-xs font-semibold font-mono">
                    {user.initials}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-ui font-semibold text-t1">{user.name}</p>
                    <p className="truncate text-meta text-t3 capitalize">{user.role}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setThemeState(toggleTheme())}
                    className="flex items-center justify-center gap-1.5 h-8 rounded-md bg-sf border border-ln text-caption text-t1 font-medium hover:bg-sf3"
                  >
                    {theme === "dark" ? <Moon className="w-3.5 h-3.5 text-t2" /> : <Sun className="w-3.5 h-3.5 text-t2" />}
                    <span>{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex items-center justify-center gap-1.5 h-8 rounded-md bg-sf border border-ln text-caption text-t1 font-medium hover:bg-sf3"
                  >
                    <LogOut className="w-3.5 h-3.5 text-t3" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}

            <p className="px-5 pb-1 text-label uppercase text-t3">Navigation</p>
            <ul className="px-3 pb-4 space-y-1">
              {overflow.map((item) => {
                const active = isActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setSheetOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-nav font-medium transition-colors ${
                        active
                          ? "bg-sf shadow-sh text-t1 font-560"
                          : "text-t2 hover:bg-sf3"
                      }`}
                    >
                      <span className="w-5 h-5 flex items-center justify-center shrink-0">
                        {item.icon(`w-5 h-5 ${active ? "text-acc" : "text-t3"}`)}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            </div>
          </div>
        </>
      )}
    </>
  );
}
