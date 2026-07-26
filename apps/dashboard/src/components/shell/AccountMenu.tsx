"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, User, SlidersHorizontal, UserCog, Moon, Sun, HelpCircle, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getStoredTheme, toggleTheme, type Theme } from "@/lib/theme";
import { Popover, PopoverPanel } from "@/components/ui/Popover";
import type { Role } from "@/components/nav-config";

export interface AccountMenuUser {
  name: string;
  email: string;
  initials: string;
  role: Role;
  available: boolean;
}

function MenuRow({
  icon,
  label,
  trailing,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "Not available yet" : undefined}
      className={`w-full flex items-center gap-2.5 h-[31px] px-2.5 rounded-sm text-ui text-left ${
        disabled ? "text-t3 cursor-not-allowed opacity-60" : "text-t1 hover:bg-sf2"
      }`}
    >
      <span className="text-t3 shrink-0 [&>svg]:w-[14.5px] [&>svg]:h-[14.5px]">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing && <span className="text-[10px] font-medium font-mono text-t3">{trailing}</span>}
    </button>
  );
}

export default function AccountMenu({
  user,
  collapsed,
}: {
  user: AccountMenuUser;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>("light");
  const router = useRouter();

  useEffect(() => setThemeState(getStoredTheme()), []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <Popover open={open} onClose={() => setOpen(false)} className="border-t border-ln pt-2.5 mt-auto shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          collapsed
            ? "w-[38px] h-[38px] mx-auto flex items-center justify-center rounded-lg hover:bg-sf3"
            : "w-full h-[42px] flex items-center gap-2.5 px-2 rounded-lg border border-transparent hover:bg-sf hover:border-ln hover:shadow-sh"
        }
      >
        <span className="relative shrink-0">
          <span className="w-[26px] h-[26px] rounded-full bg-acc flex items-center justify-center text-white text-[10.5px] font-semibold font-mono">
            {user.initials}
          </span>
          {user.available && (
            <span className="absolute -bottom-0 -right-0 w-2 h-2 rounded-full bg-pos border-2 border-rail" />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 min-w-0 text-left">
              <span className="block truncate text-ui font-560 text-t1">{user.name}</span>
              <span className="block truncate text-meta text-t3 capitalize">{user.role}</span>
            </span>
            {open ? (
              <ChevronDown className="w-[13px] h-[13px] text-t3" strokeWidth={2} />
            ) : (
              <ChevronUp className="w-[13px] h-[13px] text-t3" strokeWidth={2} />
            )}
          </>
        )}
      </button>

      {open && (
        <PopoverPanel className="absolute bottom-[52px] left-0 w-[244px]">
          <div className="px-2.5 pt-1.5 pb-2.5 border-b border-ln2 mb-1">
            <div className="truncate text-ui font-semibold text-t1">{user.name}</div>
            <div className="truncate text-[11.5px] font-450 text-t3">{user.email}</div>
          </div>

          <MenuRow icon={<User />} label="Profile" disabled />
          <MenuRow icon={<SlidersHorizontal />} label="Preferences" trailing="⌘," disabled />
          <MenuRow icon={<UserCog />} label="Switch role" disabled />
          <MenuRow
            icon={theme === "dark" ? <Moon /> : <Sun />}
            label="Theme"
            trailing={theme === "dark" ? "Dark" : "Light"}
            onClick={() => setThemeState(toggleTheme())}
          />
          <MenuRow icon={<HelpCircle />} label="Help & docs" disabled />

          <div className="h-px bg-ln2 mx-1.5 my-1" />

          <MenuRow icon={<LogOut />} label="Sign out" onClick={handleSignOut} />
        </PopoverPanel>
      )}
    </Popover>
  );
}
