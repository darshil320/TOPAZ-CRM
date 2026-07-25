import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import ClaimButton from "./ClaimButton";

export default async function WalkinsPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (isOwnerRole(sp)) redirect("/owner");

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
      .limit(50),
  ]);

  const mineIds = new Set((mine ?? []).map((r) => r.customer_id));
  const unclaimed = (customers ?? []).filter((c) => !mineIds.has(c.id));

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      <PageHeader
        title="Walk-in Queue"
        subtitle={`${unclaimed.length} unclaimed — first to tap Claim gets the customer`}
      />

      {unclaimed.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-body font-semibold text-t1">No unclaimed walk-ins</p>
          <p className="text-caption text-t3 mt-1">New visitors will appear here until claimed.</p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {unclaimed.map((c) => {
            const visits = (c.visits ?? []).slice().sort(
              (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
            );
            const latest = visits[0];
            return (
              <Card
                key={c.id}
                className="flex items-center justify-between gap-3 p-3.5 sm:p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ui text-t1 truncate">
                      {c.name ?? "Unknown"}
                    </span>
                    {latest && (
                      <Pill tone={latest.match_band === "REPEAT" ? "pos" : latest.match_band === "UNCERTAIN" ? "warn" : "neutral"} dot={false}>
                        {latest.match_band}
                      </Pill>
                    )}
                  </div>
                  {c.primary_interest ? (
                    <p className="text-caption text-t2 mt-0.5 truncate">{c.primary_interest}</p>
                  ) : c.phone ? (
                    <p className="text-caption font-mono text-t3 mt-0.5">{c.phone}</p>
                  ) : null}
                </div>
                <ClaimButton customerId={c.id} />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
