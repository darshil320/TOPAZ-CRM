import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import { normalizeSearchTerm, uuidParam } from "@/lib/search";
import { buildOrderSearchFilter } from "@/lib/listSearch";
import { listSalespersonOptions } from "@/lib/salespersonOptions";
import PageHeader from "@/components/ui/PageHeader";
import SectionHeader from "@/components/ui/SectionHeader";
import ListRow from "@/components/ui/ListRow";
import ListFilterBar from "@/components/ui/ListFilterBar";
import Pill, { type PillTone } from "@/components/ui/Pill";
import { orderStatusChip } from "./status";
import { fulfillmentLabel } from "../deliveries/types";

import Pagination from "@/components/ui/Pagination";

type Props = {
  searchParams: Promise<{ page?: string; limit?: string; q?: string; sp?: string }>;
};

function pillToneForStatus(status: string | null | undefined): PillTone {
  if (status === "installed" || status === "closed" || status === "delivered") return "pos";
  if (status === "cancelled") return "warn";
  return "neutral";
}

export default async function OrdersPage({ searchParams }: Props) {
  const { page: pageStr, limit: limitStr, q, sp: spParam } = await searchParams;
  const page = Math.max(1, Number(pageStr) || 1);
  const limit = Math.min(100, Math.max(5, Number(limitStr) || 25));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const term = normalizeSearchTerm(q);
  const salespersonId = uuidParam(spParam);
  const isFiltered = term !== null || salespersonId !== null;

  const supabase = await createServerSupabaseClient();

  // Resolved first: the search spans customers and quotations, which PostgREST
  // cannot reach from an `or` on orders (see lib/listSearch.ts).
  const searchFilter = term ? await buildOrderSearchFilter(supabase, term) : null;

  let ordersQuery = supabase
    .from("orders")
    .select(
      // `fulfillment_status` (0040) is the goods-out-the-door fact, separate from `status`:
      // an order that is part-shipped stays 'ready', and the list has to be able to say so.
      "id, order_no, status, fulfillment_status, grand_total, expected_delivery_date, created_at, customers(name, phone), salespersons(name)",
      { count: "exact" },
    );

  if (searchFilter) ordersQuery = ordersQuery.or(searchFilter);
  if (salespersonId) ordersQuery = ordersQuery.eq("salesperson_id", salespersonId);

  const [{ data: orders, count, error }, { data: outstanding }, salespersonOptions] =
    await Promise.all([
      ordersQuery.order("created_at", { ascending: false }).range(from, to),
      supabase.from("order_outstanding").select("order_id, outstanding"),
      listSalespersonOptions(supabase),
    ]);

  const totalCount = count ?? (orders ?? []).length;

  const outstandingByOrder = new Map(
    (outstanding ?? []).map((o) => [o.order_id, o.outstanding]),
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-8">
      <PageHeader
        title="Orders"
        subtitle={
          isFiltered
            ? `${totalCount} matching order${totalCount === 1 ? "" : "s"}`
            : `${totalCount} active & historical customer orders`
        }
      />

      <ListFilterBar
        searchPlaceholder="Search order no, quote no, customer name or mobile…"
        options={salespersonOptions}
        allOptionLabel="All salespersons"
      />

      {error ? (
        <div className="rounded-md border border-warn/20 bg-warnS px-4 py-3 text-caption font-semibold text-warn">
          Failed to load orders — refresh the page.
        </div>
      ) : (orders ?? []).length === 0 ? (
        <div className="bg-sf rounded-card border border-ln p-12 text-center shadow-sh">
          <p className="text-body font-semibold text-t1">
            {isFiltered ? "No orders match this search" : "No orders found"}
          </p>
          <p className="mt-1 text-caption text-t3">
            {isFiltered
              ? "Try a different order number, quote number, customer name or mobile number."
              : "Approved quotes automatically become orders in one click."}
          </p>
        </div>
      ) : (
        <div className="bg-sf rounded-card border border-ln p-4 space-y-4 shadow-sh">
          <SectionHeader
            label={isFiltered ? "Matching Orders" : "All Orders List"}
            total={`${totalCount} Total`}
          />

          <div className="space-y-2 mt-3">
            {(orders ?? []).map((o) => {
              const chip = orderStatusChip(o.status);
              const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;
              const owner = Array.isArray(o.salespersons) ? o.salespersons[0] : o.salespersons;
              const due = outstandingByOrder.get(o.id);
              const fulfilment = fulfillmentLabel(o.fulfillment_status);

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
                      {/* Only when there is something to say: "Not delivered" on every
                          confirmed order would be noise on a list this long. */}
                      {o.fulfillment_status && o.fulfillment_status !== "not_delivered" && (
                        <Pill tone={fulfilment.tone} dot={false}>
                          {fulfilment.label}
                        </Pill>
                      )}
                    </div>
                  }
                  secondary={
                    <span>
                      Customer: <span className="text-t1 font-medium">{customer?.name ?? "Unknown"}</span>
                      {customer?.phone && <span className="text-t3 font-mono"> · {customer.phone}</span>}
                      <span className="text-t3"> · Created {formatDate(o.created_at)}</span>
                      {owner?.name && <span className="text-t3"> · Sales: {owner.name}</span>}
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

          <Pagination page={page} limit={limit} total={totalCount} />
        </div>
      )}
    </div>
  );
}
