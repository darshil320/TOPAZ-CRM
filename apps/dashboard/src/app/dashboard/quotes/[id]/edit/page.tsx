import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import QuoteBuilder, { type QuoteBuilderInitial } from "../../QuoteBuilder";
import type { CustomerOption, LineDraft, ProductOption } from "../../types";

type Props = { params: Promise<{ id: string }> };

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export default async function EditQuotePage({ params }: Props) {
  const { id } = await params;
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const { data: quote } = await supabase
    .from("quotations")
    .select("*, customers(id, name, phone)")
    .eq("id", id)
    .single();

  if (!quote) notFound();
  // Only drafts are editable (the server also enforces this with a 409).
  if (quote.status !== "draft") redirect(`/dashboard/quotes/${id}`);

  const [{ data: items }, { data: products }] = await Promise.all([
    supabase
      .from("quotation_items")
      .select("*")
      .eq("quotation_id", id)
      .order("sort", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("products")
      .select("id, name, hsn, gst_rate, base_price, unit")
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);

  const customer = (Array.isArray(quote.customers) ? quote.customers[0] : quote.customers) as
    | CustomerOption
    | null;

  const lines: LineDraft[] = (items ?? []).map((it, i) => ({
    key: `init-${i}`,
    product_id: it.product_id ?? null,
    description: str(it.description),
    hsn: str(it.hsn),
    gst_rate: str(it.gst_rate),
    qty: str(it.qty),
    unit: str(it.unit),
    unit_price: str(it.unit_price),
    dimensions: str(it.dimensions),
    material: str(it.material),
    fabric: str(it.fabric),
    polish: str(it.polish),
    customization: str(it.customization),
    spec_notes: str(it.spec_notes),
  }));

  const initial: QuoteBuilderInitial = {
    customerId: quote.customer_id,
    discount: str(quote.discount_amount),
    placeOfSupply: str(quote.place_of_supply) || "GJ",
    validUntil: quote.valid_until ? String(quote.valid_until).slice(0, 10) : "",
    terms: str(quote.terms),
    notes: str(quote.notes),
    lines,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href={`/dashboard/quotes/${id}`}
          className="flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-700"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {quote.quote_no}
        </Link>
      </div>
      <PageHeader title={`Edit ${quote.quote_no}`} />

      <QuoteBuilder
        mode="edit"
        quoteId={id}
        customers={customer ? [customer] : []}
        products={(products ?? []) as ProductOption[]}
        initial={initial}
      />
    </div>
  );
}
