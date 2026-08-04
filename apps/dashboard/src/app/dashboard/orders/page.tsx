import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/format";
import { normalizeSearchTerm, uuidParam } from "@/lib/search";
import { buildOrderSearchFilter } from "@/lib/listSearch";
import { listSalespersonOptions } from "@/lib/salespersonOptions";
import { describeReadError } from "@/lib/readError";
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

  const [{ data: orders, count, error }, salespersonOptions] = await Promise.all([
    ordersQuery.order("created_at", { ascending: false }).range(from, to),
    listSalespersonOptions(supabase),
  ]);

  const totalCount = count ?? (orders ?? []).length;

  // Scoped to THIS page's orders, and therefore resolved after them.
  // `order_outstanding` is an aggregate over orders ⋈ payments (0016): selecting it
  // unfiltered made every list render sum every payment ever taken, to render a
  // "due" figure for 25 rows. One extra round-trip is cheaper than that scan, and
  // it stops getting more expensive as the business takes more money.
  const pageOrderIds = (orders ?? []).map((o) => o.id);
  const { data: outstanding } =
    pageOrderIds.length > 0
      ? await supabase
          .from("order_outstanding")
          .select("order_id, outstanding")
          .in("order_id", pageOrderIds)
      : { data: [] };
  // Names the actual cause instead of advising a refresh that cannot work — see
  // lib/readError.ts. The raw Postgres message is logged server-side, not rendered.
  const readFailure = describeReadError(error, "orders");

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

      {readFailure ? (
        <div className="rounded-md border border-warn/20 bg-warnS px-4 py-3 text-caption font-semibold text-warn">
          {readFailure.message}
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
        <div className="bg-sf rounded-card border border-ln p-0 overflow-hidden shadow-sh">
          <div className="px-4 py-3 border-b border-ln">
            <SectionHeader
              label={isFiltered ? "Matching Orders" : "All Orders List"}
              total={`${totalCount} Total`}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-body">
              <thead>
                <tr className="border-b border-ln text-label-sm uppercase text-t3 bg-sf2">
                  <th className="px-4 py-3 font-semibold">Order No</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Created Date</th>
                  <th className="px-4 py-3 font-semibold">Salesperson</th>
                  <th className="px-4 py-3 font-semibold text-right">Totals</th>
                  <th className="px-4 py-3 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ln2">
                {(orders ?? []).map((o) => {
                  const chip = orderStatusChip(o.status);
                  const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;
                  const owner = Array.isArray(o.salespersons) ? o.salespersons[0] : o.salespersons;
                  const due = outstandingByOrder.get(o.id);
                  const fulfilment = fulfillmentLabel(o.fulfillment_status);

                  return (
                    <tr key={o.id} className="hover:bg-sf2 transition-colors group">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/orders/${o.id}`} className="font-bold text-acc font-mono group-hover:underline">
                          {o.order_no}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-t1 font-semibold">{customer?.name ?? "Unknown"}</div>
                        {customer?.phone && <div className="text-t3 font-mono text-caption">{customer.phone}</div>}
                      </td>
                      <td className="px-4 py-3 text-caption text-t2 font-mono">
                        {formatDate(o.created_at)}
                      </td>
                      <td className="px-4 py-3 text-caption text-t2 font-medium">
                        {owner?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-t1 font-bold font-mono">{formatINR(o.grand_total)}</div>
                        {due != null && Number(due) > 0 && (
                          <div className="text-[11px] text-warn font-semibold">{formatINR(due)} due</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-1.5">
                          <Pill tone={pillToneForStatus(o.status)} dot={false}>
                            {chip.label}
                          </Pill>
                          {o.fulfillment_status && o.fulfillment_status !== "not_delivered" && (
                            <Pill tone={fulfilment.tone} dot={false}>
                              {fulfilment.label}
                            </Pill>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-ln bg-sf">
            <Pagination page={page} limit={limit} total={totalCount} />
          </div>
        </div>
      )}
    </div>
  );
}
