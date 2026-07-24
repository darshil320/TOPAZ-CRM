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
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-bold text-slate-900">Orders</h1>
        <p className="mt-0.5 text-sm text-slate-500">{(orders ?? []).length} orders</p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load orders — refresh the page.
        </div>
      ) : (orders ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm font-medium text-slate-600">No orders yet</p>
          <p className="mt-1 text-xs text-slate-400">Approved quotes become orders in one click.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(orders ?? []).map((o) => {
            const chip = orderStatusChip(o.status);
            const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;
            const due = outstandingByOrder.get(o.id);
            return (
              <Link
                key={o.id}
                href={`/dashboard/orders/${o.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:border-slate-300"
              >
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-slate-900">{o.order_no}</span>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {customer?.name ?? "Unknown"} · {formatDate(o.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{formatINR(o.grand_total)}</p>
                    {due != null && Number(due) > 0 && (
                      <p className="text-[11px] text-amber-600">{formatINR(due)} due</p>
                    )}
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${chip.color}`}>
                    {chip.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
