import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
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
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      <PageHeader
        title="System Admin"
        subtitle="Manage product catalog, commercial quotation settings, and messaging templates"
      />

      {/* Product Catalog Card */}
      <Card>
        <ProductAdmin products={(products ?? []) as AdminProduct[]} />
      </Card>

      {/* Settings Card */}
      <Card>
        <SettingsAdmin initial={settings} />
      </Card>

      {/* WhatsApp Templates Card */}
      <Card className="space-y-4">
        <SectionHeader label="WhatsApp Message Templates" />
        <p className="text-caption text-t3 -mt-2">
          Meta API template status for automated customer communication dispatches.
        </p>

        <div className="divide-y divide-ln2 border border-ln rounded-card overflow-hidden bg-sf2">
          {TEMPLATES.map((t) => (
            <div key={t.name} className="flex items-center justify-between p-3.5 bg-sf hover:bg-sf2 transition-colors">
              <div className="flex flex-col">
                <span className="font-mono text-ui font-semibold text-t1">{t.name}</span>
                <span className="text-caption text-t3 mt-0.5">{t.use}</span>
              </div>
              <Pill tone={t.status === "approved" ? "pos" : "neutral"} dot={true}>
                {t.status}
              </Pill>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
