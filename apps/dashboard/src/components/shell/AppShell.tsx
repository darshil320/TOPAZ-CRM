import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentSalesperson, getSessionUser } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseRole, type Role } from "@/components/nav-config";
import MobileBrand from "@/components/MobileBrand";
import MobileNav from "@/components/MobileNav";
import VisitAlertBanner from "@/components/VisitAlertBanner";
import ShellChrome, { type PresenceEntry } from "./ShellChrome";

function initialsOf(name: string | null): string {
  if (!name) return "SP";
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

export default async function AppShell({ children }: { children: ReactNode }) {
  const salesperson = await getCurrentSalesperson();
  if (!salesperson) redirect("/login");

  const role: Role = parseRole(salesperson.role);
  const isOwner = role === "owner";
  const supabase = await createServerSupabaseClient();
  // lead_followup_notifications (0050) is absent from the generated Database types
  // until they're regenerated — same widening cast the leads pages already use.
  const db = supabase as unknown as { from: (table: string) => any };

  let notifQuery = db
    .from("lead_followup_notifications")
    .select("id", { count: "exact", head: true })
    .is("cleared_at", null);
  // "My leads only": owner sees every unread notification, everyone else only
  // their own — matches lead_followup_notifications_select RLS (0050).
  if (!isOwner) notifQuery = notifQuery.eq("salesperson_id", salesperson.id);

  const [{ data: presence }, { count: unreadCount }, user] = await Promise.all([
    supabase
      .from("salespersons")
      .select("id, name")
      .eq("active", true)
      .eq("available", true)
      .order("name"),
    notifQuery as Promise<{ count: number | null }>,
    getSessionUser(),
  ]);

  return (
    <ShellChrome
      role={role}
      user={{
        name: salesperson.name ?? "Salesperson",
        email: user?.email ?? "",
        initials: initialsOf(salesperson.name),
        role,
        salespersonId: salesperson.id,
        available: salesperson.available ?? false,
      }}
      presence={(presence ?? []).map(
        (p): PresenceEntry => ({ id: p.id, name: p.name, initials: initialsOf(p.name) }),
      )}
      unreadCount={unreadCount ?? 0}
      mobileNav={
        <MobileNav
          role={role}
          user={{
            name: salesperson.name ?? "Salesperson",
            email: user?.email ?? "",
            initials: initialsOf(salesperson.name),
            role,
            available: salesperson.available ?? false,
          }}
        />
      }
      mobileBrand={<MobileBrand />}
    >
      <VisitAlertBanner salespersonId={salesperson.id} />
      {children}
    </ShellChrome>
  );
}
