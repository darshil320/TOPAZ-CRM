import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import OwnerPipelineClient, { type OwnerCustomer } from "./OwnerPipelineClient";

function ageInDays(iso: string | null): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

export default async function OwnerPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!isOwnerRole(sp)) redirect("/dashboard");

  const supabase = await createServerSupabaseClient();
  
  // Fetch pipeline stages joined with customers and active primary assignments
  const { data: rows } = await supabase
    .from("pipeline_stages")
    .select(`
      stage,
      updated_at,
      customers (
        id,
        name,
        phone,
        budget_range,
        primary_interest,
        customer_assignments (
          role,
          active,
          salespersons (
            id,
            name
          )
        )
      )
    `)
    .order("updated_at", { ascending: false });

  const initialCustomers: OwnerCustomer[] = (rows ?? [])
    .map((r: any) => {
      const c = Array.isArray(r.customers) ? r.customers[0] : r.customers;
      if (!c || !c.id) return null;

      // Extract assigned salesperson from active primary assignment
      const assignments = Array.isArray(c.customer_assignments)
        ? c.customer_assignments
        : c.customer_assignments
        ? [c.customer_assignments]
        : [];

      const primaryAssignment = assignments.find(
        (a: any) => a.active && a.role === "primary"
      );
      const spObj = Array.isArray(primaryAssignment?.salespersons)
        ? primaryAssignment.salespersons[0]
        : primaryAssignment?.salespersons;

      return {
        id: c.id,
        name: c.name ?? "Unknown Customer",
        phone: c.phone ?? null,
        budgetRange: c.budget_range ?? null,
        primaryInterest: c.primary_interest ?? null,
        stage: r.stage,
        updatedAt: r.updated_at,
        ageDays: ageInDays(r.updated_at),
        assignedSalesperson: spObj?.name ?? null,
      };
    })
    .filter((c): c is OwnerCustomer => c !== null);

  return (
    <div className="-mx-4 sm:-mx-6 px-4 sm:px-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200/80 pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Executive Pipeline</h1>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Real-time multi-stage funnel oversight · {initialCustomers.length} active deal{initialCustomers.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <OwnerPipelineClient initialCustomers={initialCustomers} />
    </div>
  );
}
