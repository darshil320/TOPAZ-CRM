import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import ClaimButton from "./ClaimButton";

import WalkinQueueListClient from "./WalkinQueueListClient";

export default async function WalkinsPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const [{ data: mine }, { data: customers }] = await Promise.all([
    supabase
      .from("customer_assignments")
      .select("customer_id")
      .eq("salesperson_id", sp.id)
      .eq("active", true),
    supabase
      .from("customers")
      .select("id, name, phone, primary_interest, created_at, visits(match_band, occurred_at)")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const mineIds = new Set((mine ?? []).map((r) => r.customer_id));
  const unclaimed = (customers ?? []).filter((c) => !mineIds.has(c.id));

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      <PageHeader
        title="Walk-in Queue"
        subtitle={`${unclaimed.length} unclaimed — first to tap Claim gets the customer`}
      />

      <WalkinQueueListClient unclaimed={unclaimed} />
    </div>
  );
}
