import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import AddSalespersonForm from "./AddSalespersonForm";
import ActiveToggle from "./ActiveToggle";

import SalespersonsTableClient from "./SalespersonsTableClient";

export default async function SalespersonsPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!isOwnerRole(sp)) redirect("/dashboard");

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

      <AddSalespersonForm />

      <SalespersonsTableClient salespersons={list} />
    </div>
  );
}
