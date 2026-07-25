"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, OWNER_NAV, SALES_NAV, type NavItem, type Role } from "@/components/nav-config";

function NavRow({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const content = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={
        collapsed
          ? `flex items-center justify-center w-[38px] h-[38px] rounded-lg ${
              active ? "bg-sf shadow-sh text-acc" : "text-t3 hover:bg-sf3"
            }`
          : `flex items-center gap-2.5 h-[var(--row)] px-2.5 rounded-md text-nav ${
              active ? "bg-sf shadow-sh text-t1 font-560" : "text-t2 hover:bg-sf3"
            }`
      }
    >
      <span className={`shrink-0 ${active ? "text-acc" : "text-t3"}`}>
        {item.icon(collapsed ? "w-[17px] h-[17px]" : "w-[16.5px] h-[16.5px]")}
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );

  return <li>{content}</li>;
}

function NavGroup({
  label,
  items,
  pathname,
  collapsed,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
}) {
  return (
    <div>
      {!collapsed && (
        <div className="px-2.5 mb-[5px] text-label uppercase text-t3">{label}</div>
      )}
      <ul className={collapsed ? "flex flex-col items-center gap-1" : "space-y-0.5"}>
        {items.map((item) => (
          <NavRow key={item.href} item={item} active={isActive(item, pathname)} collapsed={collapsed} />
        ))}
      </ul>
    </div>
  );
}

export default function NavGroups({ role, collapsed }: { role: Role; collapsed: boolean }) {
  const pathname = usePathname();

  return (
    <nav className={`flex-1 overflow-y-auto ${collapsed ? "mt-3 flex flex-col items-center gap-1" : "mt-3.5 space-y-3.5"}`}>
      {role === "owner" && (
        <NavGroup label="Management Overview" items={OWNER_NAV} pathname={pathname} collapsed={collapsed} />
      )}
      <NavGroup label="Sales Engine" items={SALES_NAV} pathname={pathname} collapsed={collapsed} />
    </nav>
  );
}
