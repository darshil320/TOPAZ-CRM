import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import ProductAdmin, { type AdminProduct } from "./ProductAdmin";
import SettingsAdmin, { type AdminSettings } from "./SettingsAdmin";

// Read-only WhatsApp template registry. Meta approval status is tracked manually
// until we wire the Meta template-status API (2B). Reflects STATE.md.
const TEMPLATES = [
  { name: "topaz_welcome", use: "Kiosk welcome message", status: "approved" },
  { name: "topaz_followup", use: "Visit follow-up message", status: "approved" },
  { name: "quote_sent", use: "Quote link (outside 24h window)", status: "pending" },
  { name: "quote_approved_confirm", use: "Approval confirmation message", status: "pending" },
  { name: "payment_due", use: "Payment reminder dispatch", status: "pending" },
];

function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

export default async function AdminPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!isOwnerRole(sp)) redirect("/dashboard");

  const supabase = await createServerSupabaseClient();
  const [{ data: products }, { data: settingsRows }] = await Promise.all([
    supabase.from("products").select("id, name, category, hsn, gst_rate, base_price, unit, active").order("name"),
    supabase.from("app_settings").select("key, value"),
  ]);

  const settingsMap = new Map((settingsRows ?? []).map((r) => [r.key, r.value]));
  const settings: AdminSettings = {
    quote_terms: typeof settingsMap.get("quote_terms") === "string" ? (settingsMap.get("quote_terms") as string) : "",
    quote_validity_days: num(settingsMap.get("quote_validity_days"), 15),
    default_advance_pct: num(settingsMap.get("default_advance_pct"), 50),
    send_receipts_to_customer: settingsMap.get("send_receipts_to_customer") === true,
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Page Title */}
      <div className="border-b border-slate-200/80 pb-4">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">System Admin</h1>
        <p className="text-xs font-medium text-slate-500 mt-1">
          Manage product catalog, commercial quotation settings, and messaging templates.
        </p>
      </div>

      {/* Product Catalog Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-sm">
        <ProductAdmin products={(products ?? []) as AdminProduct[]} />
      </div>

      {/* Settings Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-sm">
        <SettingsAdmin initial={settings} />
      </div>

      {/* WhatsApp Templates Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">WhatsApp Message Templates</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Meta API template status for automated customer communication dispatches.
          </p>
        </div>

        <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-2xl overflow-hidden bg-slate-50/50">
          {TEMPLATES.map((t) => (
            <div key={t.name} className="flex items-center justify-between p-3.5 bg-white hover:bg-slate-50 transition-colors">
              <div className="flex flex-col">
                <span className="font-mono text-xs font-bold text-slate-800">{t.name}</span>
                <span className="text-[11px] text-slate-400 font-medium mt-0.5">{t.use}</span>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                  t.status === "approved"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${t.status === "approved" ? "bg-emerald-500" : "bg-amber-500"}`} />
                {t.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
