import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import { canViewAll } from "@/lib/roles";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import AddSalespersonForm from "./AddSalespersonForm";
import ActiveToggle from "./ActiveToggle";

import SalespersonsTableClient from "./SalespersonsTableClient";

export default async function SalespersonsPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  // Admin sees the team (0052) but only owner-level manages it.
  if (!canViewAll(sp.role)) redirect("/dashboard");
  const canManage = isOwnerRole(sp);
  const isSuperAdmin = sp.role === "super_admin";

  const supabase = await createServerSupabaseClient();
  const { data: salespersons } = await supabase
    .from("salespersons")
    .select("id, name, whatsapp, role, active, auth_uid, created_at")
    .order("created_at", { ascending: true });

  const list = salespersons ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Salespersons"
        subtitle={`${list.length} total team members`}
      />

      {canManage && <AddSalespersonForm allowSuperAdmin={isSuperAdmin} />}

      <SalespersonsTableClient salespersons={list} canManage={canManage} isSuperAdmin={isSuperAdmin} />
    </div>
  );
}
