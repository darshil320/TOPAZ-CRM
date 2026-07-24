import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import ProductAdmin, { type AdminProduct } from "./ProductAdmin";
import SettingsAdmin, { type AdminSettings } from "./SettingsAdmin";

// Read-only WhatsApp template registry. Meta approval status is tracked manually
// until we wire the Meta template-status API (2B). Reflects STATE.md.
const TEMPLATES = [
  { name: "topaz_welcome", use: "Kiosk welcome", status: "approved" },
  { name: "topaz_followup", use: "Visit follow-up", status: "approved" },
  { name: "quote_sent", use: "Quote link (outside 24h)", status: "pending" },
  { name: "quote_approved_confirm", use: "Approval confirmation", status: "pending" },
  { name: "payment_due", use: "Payment reminder", status: "pending" },
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

  const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const heading = "mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400";

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-slate-900">Admin</h1>

      <div className={card}>
        <p className={heading}>Products / Catalog</p>
        <ProductAdmin products={(products ?? []) as AdminProduct[]} />
      </div>

      <div className={card}>
        <p className={heading}>Quote &amp; Payment Settings</p>
        <SettingsAdmin initial={settings} />
      </div>

      <div className={card}>
        <p className={heading}>WhatsApp Templates</p>
        <div className="divide-y divide-slate-100">
          {TEMPLATES.map((t) => (
            <div key={t.name} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-slate-800">{t.name}</span>
                <span className="ml-2 text-xs text-slate-400">{t.use}</span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  t.status === "approved" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {t.status}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Submit pending templates in WhatsApp Manager; delivery outside the 24h window needs approval.
        </p>
      </div>
    </div>
  );
}
