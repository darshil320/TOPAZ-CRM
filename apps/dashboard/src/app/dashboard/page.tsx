import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import CustomerListClient, { type MyCustomer } from "./CustomerListClient";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";

export default async function DashboardPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const isOwner = isOwnerRole(sp);

  let customers: MyCustomer[] = [];

  if (isOwner) {
    const { data: rows } = await supabase
      .from("customers")
      .select("id, name, phone, primary_interest, budget_range, created_at, pipeline_stages(stage)")
      .order("created_at", { ascending: false })
      .limit(100);

    customers = (rows ?? []).map((c) => {
      const stageObj = Array.isArray(c.pipeline_stages) ? c.pipeline_stages[0] : c.pipeline_stages;
      return {
        id: c.id,
        name: c.name ?? "Unknown Customer",
        phone: c.phone ?? null,
        primaryInterest: c.primary_interest ?? null,
        budgetRange: c.budget_range ?? null,
        stage: stageObj?.stage ?? "inquiry",
        createdAt: c.created_at,
      };
    });
  } else {
    const { data: rows } = await supabase
      .from("customer_assignments")
      .select("customers(id, name, phone, primary_interest, budget_range, created_at, pipeline_stages(stage))")
      .eq("salesperson_id", sp.id)
      .eq("active", true)
      .order("created_at", { ascending: false });

    customers = (rows ?? [])
      .map((r) => {
        const c = Array.isArray(r.customers) ? r.customers[0] : r.customers;
        if (!c) return null;
        const stageObj = Array.isArray(c.pipeline_stages) ? c.pipeline_stages[0] : c.pipeline_stages;
        return {
          id: c.id,
          name: c.name ?? "Unknown Customer",
          phone: c.phone ?? null,
          primaryInterest: c.primary_interest ?? null,
          budgetRange: c.budget_range ?? null,
          stage: stageObj?.stage ?? "inquiry",
          createdAt: c.created_at,
        };
      })
      .filter((c): c is MyCustomer => c !== null);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="My Customers"
        subtitle={
          isOwner
            ? `All customer accounts & active deal engagements · ${customers.length} total`
            : `Your assigned customer portfolio and active deal engagements · ${customers.length} assigned`
        }
      />

      <CustomerListClient initialCustomers={customers} />
    </div>
  );
}
