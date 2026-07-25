import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import QuoteBuilder, { type QuoteBuilderInitial } from "../QuoteBuilder";
import type { CustomerOption, ProductOption } from "../types";

type Props = { searchParams: Promise<{ customer?: string }> };

const VALIDITY_DAYS = Number(process.env.QUOTE_VALIDITY_DAYS) || 15;

/** yyyy-mm-dd for `today + days`, computed server-side so the client never
 * needs Date-based defaults (and can't drift from the API's validity window). */
function defaultValidUntil(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function blankInitial(customerId: string, validUntil: string, terms: string): QuoteBuilderInitial {
  return {
    customerId,
    discount: "0",
    placeOfSupply: "GJ",
    validUntil,
    terms,
    notes: "",
    lines: [
      {
        key: "init-0",
        product_id: null,
        description: "",
        hsn: "9403",
        gst_rate: "18",
        qty: "1",
        unit: "nos",
        unit_price: "",
        dimensions: "",
        material: "",
        fabric: "",
        polish: "",
        customization: "",
      },
    ],
  };
}

export default async function NewQuotePage({ searchParams }: Props) {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  const { customer } = await searchParams;

  const supabase = await createServerSupabaseClient();
  const [{ data: customers }, { data: products }, { data: settings }] = await Promise.all([
    supabase.from("customers").select("id, name, phone").order("name", { ascending: true }).limit(500),
    supabase
      .from("products")
      .select("id, name, hsn, gst_rate, base_price, unit")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase.from("app_settings").select("key, value").in("key", ["quote_terms", "quote_validity_days"]),
  ]);

  const settingsMap = new Map((settings ?? []).map((r) => [r.key, r.value]));
  const terms = typeof settingsMap.get("quote_terms") === "string" ? (settingsMap.get("quote_terms") as string) : "";
  const validityDays =
    typeof settingsMap.get("quote_validity_days") === "number"
      ? (settingsMap.get("quote_validity_days") as number)
      : VALIDITY_DAYS;

  const preselect = (customers ?? []).some((c) => c.id === customer) ? (customer as string) : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/quotes"
          className="flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-700"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Quotations
        </Link>
      </div>
      <PageHeader title="New quotation" />

      <QuoteBuilder
        mode="create"
        customers={(customers ?? []) as CustomerOption[]}
        products={(products ?? []) as ProductOption[]}
        initial={blankInitial(preselect, defaultValidUntil(validityDays), terms)}
      />
    </div>
  );
}
