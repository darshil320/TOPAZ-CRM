import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import CustomerListClient, { type MyCustomer } from "./CustomerListClient";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const supabase = await createServerSupabaseClient();

  const { data: assignments } = await supabase
    .from("customer_assignments")
    .select(`
      customer_id,
      role,
      customers (
        id, name, phone, primary_interest, budget_range, handler_mode, created_at,
        pipeline_stages ( stage )
      )
    `)
    .eq("active", true)
    .order("created_at", { ascending: false });

  const customers: MyCustomer[] = (assignments ?? [])
    .map((a: any) => {
      const c = a.customers;
      if (!c || !c.id) return null;
      return {
        id: c.id,
        name: c.name ?? "Unknown Customer",
        phone: c.phone ?? null,
        primaryInterest: c.primary_interest ?? null,
        budgetRange: c.budget_range ?? null,
        stage: c.pipeline_stages?.stage ?? "inquiry",
        createdAt: c.created_at,
      };
    })
    .filter((c): c is MyCustomer => c !== null);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="border-b border-slate-200/80 pb-4">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">My Customers</h1>
        <p className="text-xs font-medium text-slate-500 mt-1">
          Your assigned customer portfolio and active deal engagements · {customers.length} assigned
        </p>
      </div>

      <CustomerListClient initialCustomers={customers} />
    </div>
  );
}
