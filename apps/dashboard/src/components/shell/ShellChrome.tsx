"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import type { AccountMenuUser } from "./AccountMenu";
import type { Role } from "@/components/nav-config";

export interface PresenceEntry {
  id: string;
  name: string;
  initials: string;
}

export interface ShellUser {
  name: string;
  email: string;
  initials: string;
  role: Role;
  salespersonId: string;
  available: boolean;
}

const COLLAPSE_KEY = "sidebarCollapsed";

export default function ShellChrome({
  role,
  user,
  presence,
  unreadCount,
  mobileNav,
  mobileBrand,
  children,
}: {
  role: Role;
  user: ShellUser;
  presence: PresenceEntry[];
  unreadCount: number;
  mobileNav: ReactNode;
  mobileBrand: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      // ignore — falls back to expanded
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore — state still updates for this session
      }
      return next;
    });
  }

  const accountUser: AccountMenuUser = {
    name: user.name,
    email: user.email,
    initials: user.initials,
    role: role,
    available: user.available,
  };

  return (
    <div className="flex min-h-screen w-full bg-bg text-t1 font-sans antialiased">
      <Sidebar role={role} collapsed={collapsed} user={accountUser} presence={presence} />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          role={role}
          user={user}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          unreadCount={unreadCount}
          mobileBrand={mobileBrand}
        />

        <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-[28px] sm:py-[26px] pb-24 sm:pb-[26px]">
          {children}
        </main>
      </div>

      {mobileNav}
    </div>
  );
}
