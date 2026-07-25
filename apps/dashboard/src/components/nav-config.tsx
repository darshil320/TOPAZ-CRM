/**
 * Navigation model shared by the desktop Sidebar and the mobile bottom nav.
 * Single source of truth so the two navs can never drift apart.
 */
import type { ReactNode } from "react";
import {
  Users,
  UserPlus,
  FileText,
  Package,
  Kanban,
  BarChart3,
  UsersRound,
  Wallet,
  Settings,
} from "lucide-react";

export type Role = "salesperson" | "owner";

export const ICON_SIZE = "w-5 h-5";

export interface NavItem {
  href: string;
  label: string;
  /** Short label for the cramped mobile bottom bar. */
  shortLabel: string;
  icon: (className: string) => ReactNode;
  exact?: boolean;
}

const STROKE = 1.7;

export const ICONS = {
  customers: (c: string) => <Users className={c} strokeWidth={STROKE} />,
  walkin: (c: string) => <UserPlus className={c} strokeWidth={STROKE} />,
  pipeline: (c: string) => <Kanban className={c} strokeWidth={STROKE} />,
  people: (c: string) => <UsersRound className={c} strokeWidth={STROKE} />,
  analytics: (c: string) => <BarChart3 className={c} strokeWidth={STROKE} />,
  quotes: (c: string) => <FileText className={c} strokeWidth={STROKE} />,
  orders: (c: string) => <Package className={c} strokeWidth={STROKE} />,
  payments: (c: string) => <Wallet className={c} strokeWidth={STROKE} />,
  admin: (c: string) => <Settings className={c} strokeWidth={STROKE} />,
} as const;

export const SALES_NAV: NavItem[] = [
  { href: "/dashboard", label: "My Customers", shortLabel: "Customers", icon: ICONS.customers, exact: true },
  { href: "/dashboard/walkins", label: "Walk-in Queue", shortLabel: "Walk-ins", icon: ICONS.walkin, exact: true },
  { href: "/dashboard/quotes", label: "Quotations", shortLabel: "Quotes", icon: ICONS.quotes },
  { href: "/dashboard/orders", label: "Orders", shortLabel: "Orders", icon: ICONS.orders },
  { href: "/dashboard/pipeline", label: "Pipeline Board", shortLabel: "Board", icon: ICONS.pipeline },
];

export const OWNER_NAV: NavItem[] = [
  { href: "/owner", label: "Pipeline", shortLabel: "Pipeline", icon: ICONS.pipeline, exact: true },
  { href: "/owner/analytics", label: "Analytics", shortLabel: "Analytics", icon: ICONS.analytics, exact: true },
  { href: "/dashboard/payments", label: "Payments", shortLabel: "Payments", icon: ICONS.payments, exact: true },
  { href: "/owner/salespersons", label: "Salespersons", shortLabel: "Team", icon: ICONS.people, exact: true },
  { href: "/owner/admin", label: "Admin", shortLabel: "Admin", icon: ICONS.admin, exact: true },
];

/** Returns true when `href` is the active route for the given pathname. */
export function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

/** Flat nav list for a role — owner sees owner nav + the sales view too. */
export function navForRole(role: Role): NavItem[] {
  return role === "owner" ? [...OWNER_NAV, ...SALES_NAV] : SALES_NAV;
}

/** Label of the active nav item for the given pathname, for the breadcrumb. Longest-href match wins. */
export function currentNavLabel(pathname: string, role: Role): string | null {
  const matches = navForRole(role).filter((item) => isActive(item, pathname));
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).label;
}
