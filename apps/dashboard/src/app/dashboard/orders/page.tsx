import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import PageHeader from "@/components/ui/PageHeader";
import SectionHeader from "@/components/ui/SectionHeader";
import ListRow from "@/components/ui/ListRow";
import Pill, { type PillTone } from "@/components/ui/Pill";
import { orderStatusChip } from "./status";

function pillToneForStatus(status: string | null | undefined): PillTone {
  if (status === "installed" || status === "closed" || status === "delivered") return "pos";
  if (status === "cancelled") return "warn";
  return "neutral";
}

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
    <div className="space-y-6 max-w-7xl mx-auto pb-8">
      <PageHeader
        title="Orders"
        subtitle={`${(orders ?? []).length} active & historical customer orders`}
      />

      {error ? (
        <div className="rounded-md border border-warn/20 bg-warnS px-4 py-3 text-caption font-semibold text-warn">
          Failed to load orders — refresh the page.
        </div>
      ) : (orders ?? []).length === 0 ? (
        <div className="bg-sf rounded-card border border-ln p-12 text-center shadow-sh">
          <p className="text-body font-semibold text-t1">No orders yet</p>
          <p className="mt-1 text-caption text-t3">Approved quotes automatically become orders in one click.</p>
        </div>
      ) : (
        <div>
          <SectionHeader
            label="All Orders List"
            total={`${(orders ?? []).length} Total`}
          />

          <div className="space-y-2 mt-3">
            {(orders ?? []).map((o) => {
              const chip = orderStatusChip(o.status);
              const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;
              const due = outstandingByOrder.get(o.id);

              return (
                <ListRow
                  key={o.id}
                  href={`/dashboard/orders/${o.id}`}
                  primary={
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{o.order_no}</span>
                      <Pill tone={pillToneForStatus(o.status)} dot={false}>
                        {chip.label}
                      </Pill>
                    </div>
                  }
                  secondary={
                    <span>
                      Customer: <span className="text-t1 font-medium">{customer?.name ?? "Unknown"}</span>
                      <span className="text-t3"> · Created {formatDate(o.created_at)}</span>
                    </span>
                  }
                  trailing={
                    <div className="text-right">
                      <div>{formatINR(o.grand_total)}</div>
                      {due != null && Number(due) > 0 && (
                        <div className="text-[11px] text-warn">{formatINR(due)} due</div>
                      )}
                    </div>
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
