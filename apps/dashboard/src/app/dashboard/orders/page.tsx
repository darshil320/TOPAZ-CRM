import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import { orderStatusChip } from "./status";

export default async function OrdersPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const [{ data: orders, error }, { data: outstanding }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_no, status, grand_total, expected_delivery_date, created_at, customers(name)")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("order_outstanding").select("order_id, outstanding"),
  ]);

  const outstandingByOrder = new Map(
    (outstanding ?? []).map((o) => [o.order_id, o.outstanding]),
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      {/* Executive Page Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Orders</h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500 font-medium">
          {(orders ?? []).length} active &amp; historical customer orders
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-xs font-bold text-rose-700">
          Failed to load orders — refresh the page.
        </div>
      ) : (orders ?? []).length === 0 ? (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-12 text-center shadow-xs">
          <p className="text-sm font-bold text-slate-700">No orders yet</p>
          <p className="mt-1 text-xs text-slate-400">Approved quotes automatically become orders in one click.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">All Orders List</h2>
            <span className="text-xs font-bold text-slate-400">{(orders ?? []).length} Total</span>
          </div>

          <div className="space-y-2">
            {(orders ?? []).map((o) => {
              const chip = orderStatusChip(o.status);
              const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;
              const due = outstandingByOrder.get(o.id);
              const initials = customer?.name
                ? customer.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
                : "ORD";

              return (
                <Link
                  key={o.id}
                  href={`/dashboard/orders/${o.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 sm:p-4 transition-all hover:border-blue-300 hover:shadow-xs active:scale-[0.99] group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white flex items-center justify-center font-extrabold text-xs shrink-0 shadow-2xs">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                          {o.order_no}
                        </span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${chip.color}`}>
                          {chip.label}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500 font-medium">
                        Customer: <span className="text-slate-800 font-semibold">{customer?.name ?? "Unknown"}</span>
                        <span className="text-slate-400"> · Created {formatDate(o.created_at)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs sm:text-sm font-black text-slate-900">{formatINR(o.grand_total)}</p>
                      {due != null && Number(due) > 0 && (
                        <p className="text-[10px] font-bold text-amber-600">{formatINR(due)} due</p>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
