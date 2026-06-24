import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Load assigned customers with latest pipeline stage.
  const { data: assignments } = await supabase
    .from("customer_assignments")
    .select(`
      customer_id,
      role,
      customers (
        id, name, phone, primary_interest, handler_mode, created_at,
        pipeline_stages ( stage )
      )
    `)
    .eq("active", true)
    .order("created_at", { ascending: false });

  const customers = (assignments ?? [])
    .map((a) => a.customers)
    .filter(Boolean);

  return (
    <main className="max-w-2xl mx-auto p-4">
      <h1 className="text-lg font-semibold mb-4">My Customers</h1>

      {customers.length === 0 ? (
        <p className="text-sm text-gray-500">No assigned customers yet.</p>
      ) : (
        <ul className="space-y-2">
          {customers.map((c: any) => (
            <li key={c.id}>
              <a
                href={`/dashboard/customers/${c.id}`}
                className="block bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-blue-400 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{c.name ?? "Unknown"}</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {c.pipeline_stages?.stage ?? "new"}
                  </span>
                </div>
                {c.primary_interest && (
                  <p className="text-xs text-gray-500 mt-0.5">{c.primary_interest}</p>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
