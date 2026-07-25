"use client";

import Link from "next/link";
import { ChevronsUpDown, Search } from "lucide-react";
import KbdChip from "@/components/ui/KbdChip";
import NavGroups from "./NavGroups";
import AccountMenu, { type AccountMenuUser } from "./AccountMenu";
import type { Role } from "@/components/nav-config";
import type { PresenceEntry } from "./ShellChrome";

export default function Sidebar({
  role,
  collapsed,
  user,
  presence,
}: {
  role: Role;
  collapsed: boolean;
  user: AccountMenuUser;
  presence: PresenceEntry[];
}) {
  return (
    <aside
      className={`hidden sm:flex sticky top-0 h-screen shrink-0 flex-col bg-rail border-r border-ln transition-[width] ${
        collapsed ? "w-16 px-0 py-2.5 items-center" : "w-[268px] px-3 pt-3 pb-2.5"
      }`}
    >
      {/* Workspace */}
      {collapsed ? (
        <Link
          href="/dashboard"
          className="w-[29px] h-[29px] mb-3 rounded-md bg-acc flex items-center justify-center text-white text-[12.5px] font-semibold shrink-0"
          title="Topaz CRM"
        >
          T
        </Link>
      ) : (
        <Link
          href="/dashboard"
          className="h-11 flex items-center gap-2.5 px-2 rounded-lg border border-transparent hover:bg-sf hover:border-ln hover:shadow-sh"
        >
          <span className="w-[27px] h-[27px] rounded-md bg-acc flex items-center justify-center text-white text-[12.5px] font-semibold shrink-0">
            T
          </span>
          <span className="flex-1 min-w-0">
            <span className="block truncate text-ui font-semibold tracking-[-.012em] text-t1">Topaz CRM</span>
            <span className="block truncate text-[11px] font-medium text-t3">
              {role === "owner" ? "Owner" : "Sales"} workspace · Surat
            </span>
          </span>
          <ChevronsUpDown className="w-[13px] h-[13px] text-t3 shrink-0" strokeWidth={2} />
        </Link>
      )}

      {/* Search trigger — command palette not yet built, inert for now */}
      {!collapsed && (
        <button
          type="button"
          className="mt-2 h-8 flex items-center gap-2 px-2.5 rounded-md border border-ln bg-sf2 text-t3 hover:bg-sf hover:border-acc"
        >
          <Search className="w-3.5 h-3.5" strokeWidth={2} />
          <span className="flex-1 text-left text-[12.5px] font-450">Search or jump to…</span>
          <KbdChip>⌘K</KbdChip>
        </button>
      )}

      <NavGroups role={role} collapsed={collapsed} />

      {/* Presence — hide entirely if no one is on the floor */}
      {!collapsed && presence.length > 0 && (
        <div className="mt-3 pt-3 border-t border-ln shrink-0">
          <div className="flex items-center gap-1.5 mb-2 px-1">
            <span className="w-1.5 h-1.5 rounded-full bg-pos animate-[livePulse_2.4s_ease-out_infinite]" />
            <span className="text-label uppercase text-t3">On the floor</span>
            <span className="ml-auto text-[11px] font-medium font-mono text-t3">{presence.length}</span>
          </div>
          <div className="space-y-0.5 max-h-[140px] overflow-y-auto pr-1">
            {presence.map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 px-1 py-[5px] rounded-sm hover:bg-sf3">
                <span className="w-[22px] h-[22px] rounded-full bg-sf3 flex items-center justify-center text-[9.5px] font-semibold font-mono text-t2 shrink-0">
                  {p.initials}
                </span>
                <span className="flex-1 truncate text-[12px] font-medium text-t1">{p.name}</span>
                <span className="text-[10.5px] font-450 text-t3">Free</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AccountMenu user={user} collapsed={collapsed} />
    </aside>
  );
}
