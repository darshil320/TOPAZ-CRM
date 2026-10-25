/**
 * Staff role groups — the dashboard's copy of apps/api/src/services/roles.py and the
 * SQL helpers of migration 0052. One place per "who counts as …" decision, so a page
 * never re-derives it from string comparisons.
 *
 *   owner-level  owner, super_admin                  ⇔ is_owner()
 *   view-all     + admin: sees/edits everything, removes nothing ⇔ can_view_all()
 *   dispatcher   + front_desk: assigns walk-ins, quotes on behalf ⇔ is_dispatcher()
 *
 * Presentation only. The API (authz.py) and RLS enforce every one of these; hiding a
 * button here is convenience, never security.
 */

type MaybeRole = string | null | undefined;

const OWNER_LEVEL: readonly string[] = ["owner", "super_admin"];
const VIEW_ALL: readonly string[] = [...OWNER_LEVEL, "admin"];
const DISPATCH: readonly string[] = [...VIEW_ALL, "front_desk"];
const NO_REMOVAL: readonly string[] = ["admin"];

export const isOwnerLevel = (role: MaybeRole) => OWNER_LEVEL.includes(role ?? "");
export const canViewAll = (role: MaybeRole) => VIEW_ALL.includes(role ?? "");
export const isDispatcher = (role: MaybeRole) => DISPATCH.includes(role ?? "");
/** False for roles that may never delete, deactivate, retire or cancel (admin). */
export const canRemove = (role: MaybeRole) => !NO_REMOVAL.includes(role ?? "");
export const isFrontDesk = (role: MaybeRole) => role === "front_desk";
