"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PanelLeft, Bell, Plus } from "lucide-react";
import { currentNavLabel, type Role } from "@/components/nav-config";
import { IconButton, buttonVariants } from "@/components/ui/Button";
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

        <div className="w-px h-5 bg-ln" />

        <Link href="/dashboard/quotes/new" className={buttonVariants({ variant: "primary" })}>
          <Plus className="w-3.5 h-3.5" strokeWidth={2.1} />
          <span className="whitespace-nowrap">New Quote</span>
        </Link>
      </div>
    </header>
  );
}
