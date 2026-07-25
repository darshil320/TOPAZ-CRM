"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PanelLeft, Bell, Plus, Moon, Sun, LogOut } from "lucide-react";
import { currentNavLabel, type Role } from "@/components/nav-config";
import { IconButton, buttonVariants } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { getStoredTheme, toggleTheme, type Theme } from "@/lib/theme";
import type { ShellUser } from "./ShellChrome";
import StatusPill from "./StatusPill";

const ANCESTOR_LABEL: Record<Role, string> = {
  owner: "Owner Control",
  salesperson: "Sales Engine",
};

export default function TopBar({
  role,
  user,
  collapsed,
  onToggleCollapse,
  unreadCount,
  mobileBrand,
}: {
  role: Role;
  user: ShellUser;
  collapsed: boolean;
  onToggleCollapse: () => void;
  unreadCount: number;
  mobileBrand: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const current = currentNavLabel(pathname, role) ?? "Dashboard";

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>("light");
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setThemeState(getStoredTheme()), []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMenuOpen]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-30 h-[57px] shrink-0 flex items-center gap-3 pl-3 pr-5 border-b border-ln bg-bg/95 backdrop-blur-md">
      <IconButton
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="hidden sm:flex"
      >
        <PanelLeft className="w-4 h-4" strokeWidth={1.7} />
      </IconButton>

      {mobileBrand}

      <div className="hidden sm:flex items-center gap-1.5 min-w-0">
        <span className="text-body text-t3 truncate">{ANCESTOR_LABEL[role]}</span>
        <span className="text-t3 opacity-55">/</span>
        <span className="text-[13px] font-560 tracking-[-.01em] text-t1 truncate">{current}</span>
      </div>

      <div className="flex items-center gap-2.5 ml-auto">
        <StatusPill salespersonId={user.salespersonId} initialAvailable={user.available} />

        <IconButton title="Notifications" className="relative">
          <Bell className="w-4 h-4" strokeWidth={1.7} />
          {unreadCount > 0 && (
            <span className="absolute top-[6px] right-[7px] w-[5px] h-[5px] rounded-full bg-warn" />
          )}
        </IconButton>

        {/* Mobile User Profile Avatar & Menu Popover */}
        <div ref={mobileMenuRef} className="relative sm:hidden">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="User menu"
            className="w-[28px] h-[28px] rounded-full bg-acc flex items-center justify-center text-white text-[10.5px] font-semibold font-mono"
          >
            {user.initials}
          </button>

          {mobileMenuOpen && (
            <div className="absolute right-0 top-9 w-[240px] bg-sf rounded-pop shadow-shp p-[5px] border border-ln animate-popIn z-50">
              <div className="px-2.5 pt-1.5 pb-2.5 border-b border-ln2 mb-1">
                <div className="truncate text-ui font-semibold text-t1">{user.name}</div>
                <div className="truncate text-[11.5px] font-450 text-t3">{user.email}</div>
              </div>

              <button
                type="button"
                onClick={() => setThemeState(toggleTheme())}
                className="w-full flex items-center gap-2.5 h-[31px] px-2.5 rounded-sm text-ui text-left text-t1 hover:bg-sf2"
              >
                <span className="text-t3 shrink-0 [&>svg]:w-[14.5px] [&>svg]:h-[14.5px]">
                  {theme === "dark" ? <Moon /> : <Sun />}
                </span>
                <span className="flex-1 truncate">Theme</span>
                <span className="text-meta text-t3 font-mono">{theme === "dark" ? "Dark" : "Light"}</span>
              </button>

              <div className="h-px bg-ln2 mx-1.5 my-1" />

              <button
                type="button"
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 h-[31px] px-2.5 rounded-sm text-ui text-left text-t1 hover:bg-sf2"
              >
                <span className="text-t3 shrink-0 [&>svg]:w-[14.5px] [&>svg]:h-[14.5px]">
                  <LogOut />
                </span>
                <span className="flex-1 truncate">Sign out</span>
              </button>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-ln" />

        <Link href="/dashboard/quotes/new" className={buttonVariants({ variant: "primary" })}>
          <Plus className="w-3.5 h-3.5" strokeWidth={2.1} />
          <span className="whitespace-nowrap">New Quote</span>
        </Link>
      </div>
    </header>
  );
}
