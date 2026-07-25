"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PanelLeft, Bell, Plus } from "lucide-react";
import { currentNavLabel, type Role } from "@/components/nav-config";
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
  const current = currentNavLabel(pathname, role) ?? "Dashboard";

  return (
    <header className="h-[57px] shrink-0 flex items-center gap-3 pl-3 pr-5 border-b border-ln">
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="hidden sm:flex w-[30px] h-[30px] items-center justify-center rounded-sm hover:bg-sf2"
      >
        <PanelLeft className="w-4 h-4 text-t2" strokeWidth={1.7} />
      </button>

      {mobileBrand}

      <div className="hidden sm:flex items-center gap-1.5 min-w-0">
        <span className="text-body text-t3 truncate">{ANCESTOR_LABEL[role]}</span>
        <span className="text-t3 opacity-55">/</span>
        <span className="text-[13px] font-560 tracking-[-.01em] text-t1 truncate">{current}</span>
      </div>

      <div className="flex items-center gap-2.5 ml-auto">
        <StatusPill salespersonId={user.salespersonId} initialAvailable={user.available} />

        <button
          type="button"
          title="Notifications"
          className="relative w-[30px] h-[30px] flex items-center justify-center rounded-sm hover:bg-sf2"
        >
          <Bell className="w-4 h-4 text-t2" strokeWidth={1.7} />
          {unreadCount > 0 && (
            <span className="absolute top-[6px] right-[7px] w-[5px] h-[5px] rounded-full bg-warn" />
          )}
        </button>

        <div className="w-px h-5 bg-ln" />

        <Link
          href="/dashboard/quotes/new"
          className="h-[31px] flex items-center gap-1.5 pl-2.5 pr-[13px] rounded-md bg-acc text-white hover:brightness-[1.08]"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.1} />
          <span className="text-[12.5px] font-560 tracking-[-.005em] whitespace-nowrap">New Quote</span>
        </Link>
      </div>
    </header>
  );
}
