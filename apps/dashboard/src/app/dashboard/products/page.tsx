import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ScanLine } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { canManageProducts, canViewStock } from "@/lib/roles";
import { normalizeSearchTerm } from "@/lib/search";
import { describeReadError } from "@/lib/readError";
import { getMediaUrls } from "@/lib/media/actions";
import { listProducts, type ActiveFilter } from "@/lib/products/list";
import { listCategories, listLocations, pricesFor, stockFor, stockAtLocations } from "@/lib/products/reads";
import { STOCK_STATUSES, STOCK_STATUS_LABEL, isStockStatus } from "@/lib/products/types";
import PageHeader from "@/components/ui/PageHeader";
import ListFilterBar from "@/components/ui/ListFilterBar";
import Pagination from "@/components/ui/Pagination";
import { buttonVariants } from "@/components/ui/Button";
import ProductListClient, { type ProductCard } from "./ProductListClient";

type Props = {
  searchParams: Promise<{
    q?: string;
    cat?: string;
    loc?: string;
    status?: string;
    show?: string;
    page?: string;
    limit?: string;
  }>;
};

const SHOW_OPTIONS: { id: ActiveFilter; label: string }[] = [
  { id: "inactive", label: "Inactive only" },
  { id: "all", label: "Active + inactive" },
];

export default async function ProductsPage({ searchParams }: Props) {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  const params = await searchParams;

  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(params.limit) || 25));
  const manage = canManageProducts(sp.role);
  const stockVisible = canViewStock(sp.role);

  const supabase = await createServerSupabaseClient();
  const [locations, categories] = await Promise.all([
    stockVisible ? listLocations(supabase) : Promise.resolve([]),
    listCategories(supabase),
  ]);

  // Only values the database already knows survive — a crafted URL can only narrow.
  const term = normalizeSearchTerm(params.q);
  const category = params.cat && categories.includes(params.cat) ? params.cat : null;
  const location = locations.find((l) => l.code === params.loc) ?? null;
  const status = isStockStatus(params.status) ? params.status : null;
  const show: ActiveFilter = manage && (params.show === "inactive" || params.show === "all") ? params.show : "active";
  const isFiltered = Boolean(term || category || location || status || show !== "active");

  const { rows, count, error } = await listProducts(supabase, {
    term,
    category,
    locationId: location?.id ?? null,
    status,
    show,
    from: (page - 1) * limit,
    to: page * limit - 1,
  });
  const readFailure = describeReadError(error, "products");

  const ids = rows.map((r) => r.id);
  const [prices, stock, thumbs] = await Promise.all([
    pricesFor(supabase, sp.role, ids),
    stockFor(supabase, sp.role, ids),
    getMediaUrls(rows.map((r) => r.primary_media_id).filter((m): m is string => Boolean(m)), true),
  ]);

  const cards: ProductCard[] = rows.map((r) => ({
    ...r,
    thumbUrl: r.primary_media_id ? thumbs.data?.[r.primary_media_id]?.url ?? null : null,
    price: prices.get(r.id) ?? null,
    stock: stockVisible ? stockAtLocations(locations, stock.get(r.id)) : null,
  }));

  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="Products & Stock"
          subtitle={
            isFiltered
              ? `${count} matching product${count === 1 ? "" : "s"}`
              : `${count} product${count === 1 ? "" : "s"} across ${locations.length || "all"} locations`
          }
        />
        <div className="flex items-center gap-2">
          <Link href="/scan" className={buttonVariants({ variant: "secondary" })}>
            <ScanLine className="h-3.5 w-3.5" strokeWidth={2} /> Scan
          </Link>
          {manage && (
            <Link href="/dashboard/products/new" className={buttonVariants({ variant: "primary" })}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Add product
            </Link>
          )}
        </div>
      </div>

      <ListFilterBar
        searchPlaceholder="Search name, category or sticker code…"
        options={categories.map((c) => ({ id: c, label: c }))}
        allOptionLabel="All categories"
        filterParam="cat"
        extraFilters={[
          {
            param: "loc",
            allLabel: "All locations",
            options: locations.map((l) => ({ id: l.code, label: l.name })),
          },
          {
            param: "status",
            allLabel: "Any stock status",
            options: STOCK_STATUSES.map((s) => ({ id: s, label: STOCK_STATUS_LABEL[s] })),
          },
          ...(manage ? [{ param: "show", allLabel: "Active only", options: SHOW_OPTIONS }] : []),
        ]}
      />

      {readFailure ? (
        <div className="rounded-md border border-warn/20 bg-warnS px-4 py-3 text-caption font-semibold text-warn">
          {readFailure.message}
        </div>
      ) : cards.length === 0 ? (
        <div className="bg-sf rounded-card border border-ln p-12 text-center shadow-sh">
          <p className="text-body font-semibold text-t1">
            {isFiltered ? "No products match these filters" : "No products yet"}
          </p>
          <p className="mt-1 text-caption text-t3">
            {isFiltered
              ? "Try a different name, category or location."
              : manage
                ? "Add your first product — a QR code is created automatically."
                : "Products added by the owner or an admin appear here."}
          </p>
        </div>
      ) : (
        <div className="bg-sf rounded-card border border-ln overflow-hidden shadow-sh">
          <ProductListClient products={cards} canPrint={manage} />
          <div className="p-4 border-t border-ln">
            <Pagination page={page} limit={limit} total={count} />
          </div>
        </div>
      )}
    </div>
  );
}
