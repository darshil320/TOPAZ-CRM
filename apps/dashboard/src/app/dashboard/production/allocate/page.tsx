import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { formatDate, isPastDay, todayISO } from "@/lib/format";
import { listWorkshops } from "@/lib/workshops";
import PageHeader from "@/components/ui/PageHeader";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
import AssignModal, { type WorkshopOption } from "./AssignModal";

// Mirrors the API's own gate (api/production.py): a workshop manager must never
// self-allocate, and accounts/delivery have no production role at all.
const ALLOCATING_ROLES = new Set(["owner", "admin", "salesperson"]);

// Same ceiling as production_repo.unallocated_items so the two views agree.
const QUEUE_LIMIT = 200;

interface QueueItem {
  id: string;
  description: string;
  qty: number;
  unit: string | null;
  dimensions: string | null;
  material: string | null;
  sort: number;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  orderCreatedAt: string;
  expectedDeliveryDate: string | null;
  customerName: string;
}

/** PostgREST returns an embedded row as an object or a one-element array. */
function one<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Sort in JS, not in PostgREST: ordering a top-level result by an EMBEDDED
 * column is unreliable, and the queue is capped at 200 rows.
 * Order matches the API: soonest delivery first, undated last.
 */
function byUrgency(a: QueueItem, b: QueueItem): number {
  const ad = a.expectedDeliveryDate;
  const bd = b.expectedDeliveryDate;
  if (ad !== bd) {
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? -1 : 1;
  }
  if (a.orderCreatedAt !== b.orderCreatedAt) return a.orderCreatedAt < b.orderCreatedAt ? -1 : 1;
  return a.sort - b.sort;
}

export default async function AllocatePage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!ALLOCATING_ROLES.has(sp.role ?? "")) redirect("/dashboard");

  const supabase = await createServerSupabaseClient();

  // Items read direct from Supabase under RLS (house pattern, §19-G). Workshops
  // come from the API because their open-item count is an aggregate RLS hides.
  const [{ data: rows, error }, workshopList] = await Promise.all([
    supabase
      .from("order_items")
      .select(
        "id, description, qty, unit, dimensions, material, sort, order_id," +
          " orders!inner(order_no, status, expected_delivery_date, created_at," +
          " customers!inner(name))",
      )
      .is("workshop_id", null)
      .in("orders.status", ["confirmed", "in_production"])
      .limit(QUEUE_LIMIT),
    listWorkshops(false),
  ]);

  const items: QueueItem[] = ((rows as any[]) ?? [])
    .map((row: any): QueueItem | null => {
      const order = one(row.orders);
      if (!order) return null;
      const customer = one(order.customers);
      return {
        id: row.id,
        description: row.description,
        qty: row.qty,
        unit: row.unit,
        dimensions: row.dimensions,
        material: row.material,
        sort: row.sort,
        orderId: row.order_id,
        orderNo: order.order_no,
        orderStatus: order.status,
        orderCreatedAt: order.created_at,
        expectedDeliveryDate: order.expected_delivery_date,
        customerName: customer?.name ?? "Unknown customer",
      };
    })
    .filter((item): item is QueueItem => item !== null)
    .sort(byUrgency);

  const activeWorkshops: WorkshopOption[] = workshopList.workshops
    .filter((w) => w.active)
    .map((w) => ({ id: w.id, name: w.name, type: w.type, openItemCount: w.open_item_count ?? 0 }));

  const noWorkshopsAtAll = workshopList.error === null && workshopList.workshops.length === 0;
  const allDeactivated =
    workshopList.error === null && workshopList.workshops.length > 0 && activeWorkshops.length === 0;
  const today = todayISO();

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-8">
      <PageHeader
        title="Allocate production"
        subtitle={`${items.length} confirmed item${items.length === 1 ? "" : "s"} waiting for a workshop`}
      />

      {workshopList.error && (
        <div className="rounded-md border border-warn/20 bg-warnS px-4 py-3 text-caption font-semibold text-warn">
          {workshopList.error} Allocation is disabled until the workshop list loads.
        </div>
      )}

      {/* The workshops table ships EMPTY on purpose (0023) — a placeholder workshop
          can receive a real allocation. So this is an instruction, not a blank select. */}
      {noWorkshopsAtAll && (
        <div className="rounded-card border border-ln bg-sf p-12 text-center shadow-sh">
          <p className="text-body font-semibold text-t1">No workshops yet</p>
          <p className="mt-1 text-caption text-t3">
            Production work can only be allocated to a registered workshop.
          </p>
          <Link
            href="/owner/admin#workshops"
            className="mt-4 inline-flex h-[31px] items-center rounded-md border border-ln bg-sf px-3 text-[12.5px] font-560 text-t1 hover:border-accL hover:bg-sf2"
          >
            Add one in Admin → Workshops
          </Link>
        </div>
      )}

      {allDeactivated && (
        <div className="rounded-card border border-ln bg-sf p-12 text-center shadow-sh">
          <p className="text-body font-semibold text-t1">Every workshop is deactivated</p>
          <p className="mt-1 text-caption text-t3">
            Reactivate one, or add a new workshop, before allocating work.
          </p>
          <Link
            href="/owner/admin#workshops"
            className="mt-4 inline-flex h-[31px] items-center rounded-md border border-ln bg-sf px-3 text-[12.5px] font-560 text-t1 hover:border-accL hover:bg-sf2"
          >
            Open Admin → Workshops
          </Link>
        </div>
      )}

      {error ? (
        <div className="rounded-md border border-warn/20 bg-warnS px-4 py-3 text-caption font-semibold text-warn">
          Failed to load the unallocated queue — refresh the page.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-card border border-ln bg-sf p-12 text-center shadow-sh">
          <p className="text-body font-semibold text-t1">Nothing waiting for a workshop</p>
          <p className="mt-1 text-caption text-t3">
            Every confirmed order item has been allocated. New items appear here the moment an
            order is confirmed.
          </p>
        </div>
      ) : (
        <div className="rounded-card border border-ln bg-sf p-4 shadow-sh">
          <SectionHeader label="Unallocated items" total={`${items.length} waiting`} />

          <div className="mt-3 space-y-2.5">
            {items.map((item) => {
              const overdue = isPastDay(item.expectedDeliveryDate);
              const specs = [
                item.dimensions,
                item.material,
                `Qty ${item.qty}${item.unit ? ` ${item.unit}` : ""}`,
              ].filter(Boolean) as string[];

              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-card border border-ln bg-sf px-4 py-3.5 hover:border-accL sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13.5px] font-semibold text-t1">
                        {item.description}
                      </span>
                      {item.orderStatus === "in_production" && (
                        <Pill tone="neutral" dot={false}>
                          In production
                        </Pill>
                      )}
                    </div>

                    <p className="mt-[3px] truncate text-caption text-t2">
                      {specs.map((spec, i) => (
                        <span key={spec}>
                          {i > 0 && <span className="text-t3"> · </span>}
                          <span className={i === specs.length - 1 ? "font-mono tabular-nums" : ""}>
                            {spec}
                          </span>
                        </span>
                      ))}
                    </p>

                    <p className="mt-[3px] truncate text-caption text-t3">
                      <Link
                        href={`/dashboard/orders/${item.orderId}`}
                        className="font-mono text-t2 hover:text-acc"
                      >
                        {item.orderNo}
                      </Link>
                      <span> · {item.customerName}</span>
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-left sm:text-right">
                      <div className="text-label uppercase text-t3">Delivery</div>
                      <div
                        className={`mt-0.5 font-mono text-[12px] tabular-nums ${
                          overdue ? "font-semibold text-warn" : "text-t2"
                        }`}
                      >
                        {formatDate(item.expectedDeliveryDate)}
                        {overdue && <span className="ml-1 font-sans">overdue</span>}
                      </div>
                    </div>

                    <AssignModal
                      itemId={item.id}
                      itemDescription={item.description}
                      orderNo={item.orderNo}
                      customerName={item.customerName}
                      workshops={activeWorkshops}
                      todayISO={today}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
