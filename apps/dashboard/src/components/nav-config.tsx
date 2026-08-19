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
  Factory,
  Truck,
  Route,
} from "lucide-react";

/**
 * The staff roles the DB allows (`salespersons.role`, migration 0011). The shell
 * only branches owner-vs-rest for layout, but individual nav items gate on the
 * real role — an accounts or delivery user must not be shown a production route
 * the API would 403.
 */
export type Role =
  | "salesperson"
  | "owner"
  | "admin"
  | "accounts"
  | "workshop_manager"
  | "delivery";

const ROLES: readonly Role[] = [
  "salesperson",
  "owner",
  "admin",
  "accounts",
  "workshop_manager",
  "delivery",
];

/** Narrow a raw `salespersons.role` string; anything unknown is a plain salesperson. */
export function parseRole(raw: string | null | undefined): Role {
  return ROLES.includes(raw as Role) ? (raw as Role) : "salesperson";
}

export const ICON_SIZE = "w-5 h-5";

export interface NavItem {
  href: string;
  label: string;
  /** Short label for the cramped mobile bottom bar. */
  shortLabel: string;
  icon: (className: string) => ReactNode;
  exact?: boolean;
  /** Omit to show the item to every role; otherwise an allowlist. */
  roles?: readonly Role[];
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
  production: (c: string) => <Factory className={c} strokeWidth={STROKE} />,
  delivery: (c: string) => <Truck className={c} strokeWidth={STROKE} />,
  // Module 14: workshop→workshop movement. A distinct icon from `delivery` on purpose —
  // the two are different journeys (mid-production vs to the customer) and a driver
  // must never confuse the two lists.
  transit: (c: string) => <Route className={c} strokeWidth={STROKE} />,
} as const;

/** Roles the production allocate route accepts — mirrors api/production.py. */
const ALLOCATING_ROLES: readonly Role[] = ["owner", "admin", "salesperson"];

/**
 * Roles that can open the inter-workshop transit app (module 14). `delivery` is the
 * courier the app is FOR; owner/admin get in to unstick a run when a driver's phone is
 * dead — which is also exactly what api/transfers.py allows, so no nav item here 403s.
 * A `workshop_manager` is deliberately absent: they act on consignments from their own
 * queue's Incoming section, not from a driver's run list.
 */
const TRANSIT_ROLES: readonly Role[] = ["delivery", "owner", "admin"];

export const SALES_NAV: NavItem[] = [
  { href: "/dashboard", label: "My Customers", shortLabel: "Customers", icon: ICONS.customers, exact: true },
  { href: "/dashboard/walkins", label: "Walk-in Queue", shortLabel: "Walk-ins", icon: ICONS.walkin, exact: true },
  // "Lead Capture", not "Leads": /dashboard/pipeline already occupies the "Leads"
  // short label, and two nav items reading the same word is a support call.
  { href: "/dashboard/leads", label: "Lead Capture", shortLabel: "Enquiries", icon: ICONS.pipeline },
  { href: "/dashboard/quotes", label: "Quotations", shortLabel: "Quotes", icon: ICONS.quotes },
  { href: "/dashboard/orders", label: "Orders", shortLabel: "Orders", icon: ICONS.orders },
  {
    href: "/dashboard/deliveries",
    label: "Deliveries",
    shortLabel: "Deliveries",
    icon: ICONS.delivery,
    exact: true,
  },
  {
    href: "/dashboard/production/allocate",
    label: "Allocate Production",
    shortLabel: "Allocate",
    icon: ICONS.production,
    exact: true,
    roles: ALLOCATING_ROLES,
  },
  {
    href: "/dashboard/production",
    label: "Production Board",
    shortLabel: "Production",
    icon: ICONS.production,
    exact: true,
  },
  {
    href: "/transit",
    label: "Workshop Transit",
    shortLabel: "Transit",
    icon: ICONS.transit,
    exact: true,
    roles: TRANSIT_ROLES,
  },
  { href: "/dashboard/pipeline", label: "Lead Pipeline", shortLabel: "Leads", icon: ICONS.pipeline },
];

export const OWNER_NAV: NavItem[] = [
  { href: "/owner", label: "Pipeline", shortLabel: "Pipeline", icon: ICONS.pipeline, exact: true },
  {
    href: "/dashboard/production",
    label: "Production Board",
    shortLabel: "Production",
    icon: ICONS.production,
    exact: true,
  },
  {
    href: "/dashboard/deliveries",
    label: "Deliveries",
    shortLabel: "Deliveries",
    icon: ICONS.delivery,
    exact: true,
  },
  { href: "/owner/analytics", label: "Analytics", shortLabel: "Analytics", icon: ICONS.analytics, exact: true },
  { href: "/dashboard/payments", label: "Payments", shortLabel: "Payments", icon: ICONS.payments, exact: true },
  { href: "/owner/salespersons", label: "Salespersons", shortLabel: "Team", icon: ICONS.people, exact: true },
  { href: "/owner/admin", label: "Admin", shortLabel: "Admin", icon: ICONS.admin, exact: true },
];

/** Returns true when `href` is the active route for the given pathname. */
export function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

/** Drop the items this role may not use. Returns a new array — never mutates. */
export function visibleTo(items: NavItem[], role: Role): NavItem[] {
  return items.filter((item) => !item.roles || item.roles.includes(role));
}

/** Flat nav list for a role — owner sees owner nav + the sales view too. */
export function navForRole(role: Role): NavItem[] {
  const base = role === "owner" ? [...OWNER_NAV, ...SALES_NAV] : SALES_NAV;
  return visibleTo(base, role);
}

/** Label of the active nav item for the given pathname, for the breadcrumb. Longest-href match wins. */
export function currentNavLabel(pathname: string, role: Role): string | null {
  const matches = navForRole(role).filter((item) => isActive(item, pathname));
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).label;
}
