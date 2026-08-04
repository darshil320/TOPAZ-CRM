import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
import ProductAdmin, { type AdminProduct } from "./ProductAdmin";
import SettingsAdmin, { type AdminSettings } from "./SettingsAdmin";
import WorkshopAdmin from "./WorkshopAdmin";
import WorkshopStaffAdmin, { type StaffWorkshop } from "./WorkshopStaffAdmin";
import RouteTemplateAdmin from "./RouteTemplateAdmin";
import StagePlanAdmin from "./StagePlanAdmin";
import { listWorkshops } from "@/lib/workshops";
import { listAllWorkshopStaff, listRouteTemplates, listStageDefaults } from "@/lib/production/reads";
import type { StageDef } from "@/lib/production/types";
import { addWorkshop, updateWorkshop, deactivateWorkshop } from "./actions";

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

type Props = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function AdminPage({ searchParams }: Props) {
  const { tab = "production" } = await searchParams;

  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!isOwnerRole(sp)) redirect("/dashboard");

  const supabase = await createServerSupabaseClient();

  // ─── ONLY WHAT THIS TAB RENDERS ──────────────────────────────────────────────
  // This page has three tabs and used to load ALL of their data on every visit:
  // opening "System Settings" fetched the product catalog, the workshops, the route
  // templates, the stage defaults AND a staff roster per workshop — four API
  // round-trips plus N more, to render a four-field form. The tab is known here (it
  // is a URL param, and switching tabs is a navigation), so each tab now pays only
  // for itself.
  const NONE = Promise.resolve({ data: null, error: null });
  const productionTab = tab === "production";
  const catalogTab = tab === "catalog";
  const settingsTab = tab === "settings";

  const [
    { data: products },
    { data: settingsRows },
    { data: salespersons },
    { data: stageRows },
    workshopResult,
    templateResult,
    stageDefaultsResult,
    rosterResult,
  ] = await Promise.all([
    catalogTab
      ? supabase
          .from("products")
          .select("id, name, category, hsn, gst_rate, base_price, unit, active, primary_media_id")
          .order("name")
      : NONE,
    settingsTab ? supabase.from("app_settings").select("key, value") : NONE,
    // The manager/staff pickers live on the production tab only.
    productionTab
      ? supabase.from("salespersons").select("id, name, role").eq("active", true).order("name")
      : NONE,
    productionTab
      ? supabase
          .from("production_stage_defs")
          .select("code, sort, label_en, label_gu, photo_required, active")
          .eq("active", true)
          .order("sort")
      : NONE,
    productionTab ? listWorkshops(false) : Promise.resolve({ workshops: [], error: null }),
    productionTab ? listRouteTemplates(false) : NONE,
    productionTab ? listStageDefaults() : NONE,
    // ONE call for every roster — see listAllWorkshopStaff. This was a loop of one
    // API call per active workshop, issued after the wave above had already
    // finished, so it was a second serial hop that grew with the workshop count.
    productionTab ? listAllWorkshopStaff() : NONE,
  ]);

  const rosters = rosterResult.data?.rosters ?? {};
  const staffWorkshops: StaffWorkshop[] = workshopResult.workshops
    .filter((w) => w.active)
    .map((w) => ({
      id: w.id,
      name: w.name,
      type: w.type,
      active: w.active,
      staff: rosters[w.id] ?? [],
    }));
  const rosterError = rosterResult.error;

  const settingsMap = new Map((settingsRows ?? []).map((r) => [r.key, r.value]));
  const settings: AdminSettings = {
    quote_terms: typeof settingsMap.get("quote_terms") === "string" ? (settingsMap.get("quote_terms") as string) : "",
    quote_validity_days: num(settingsMap.get("quote_validity_days"), 15),
    default_advance_pct: num(settingsMap.get("default_advance_pct"), 50),
    send_receipts_to_customer: settingsMap.get("send_receipts_to_customer") === true,
  };

  const managerOptions = (salespersons ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
  }));

  const TABS = [
    { id: "production", label: "Production & Routing" },
    { id: "catalog", label: "Product Catalog" },
    { id: "settings", label: "System Settings" },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      <PageHeader
        title="System Admin"
        subtitle="Manage workshops & vendors, product catalog, quotation policies, and messaging templates"
      />

      <div className="flex items-center gap-1.5 p-1.5 bg-sf2 rounded-xl border border-ln w-fit overflow-x-auto shadow-sh">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/owner/admin?tab=${t.id}`}
            className={`px-4 py-2 rounded-lg text-caption font-semibold transition-all whitespace-nowrap ${
              tab === t.id
                ? "bg-sf shadow-shp text-t1 border-none"
                : "text-t3 hover:text-t1 hover:bg-sf/50 border-none"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "production" && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="shadow-sh border-ln">
            <WorkshopAdmin
              workshops={workshopResult.workshops}
              managers={managerOptions}
              loadError={workshopResult.error}
              onAdd={addWorkshop}
              onUpdate={updateWorkshop}
              onDeactivate={deactivateWorkshop}
            />
          </Card>

          <Card className="shadow-sh border-ln">
            <WorkshopStaffAdmin
              workshops={staffWorkshops}
              staffOptions={managerOptions}
              loadError={rosterError}
            />
          </Card>

          <Card className="shadow-sh border-ln">
            <RouteTemplateAdmin
              templates={templateResult.data?.templates ?? []}
              workshops={workshopResult.workshops}
              stages={(stageRows ?? []) as StageDef[]}
              loadError={templateResult.error}
            />
          </Card>

          <Card className="shadow-sh border-ln">
            <StagePlanAdmin
              stages={stageDefaultsResult.data?.stages ?? []}
              loadError={stageDefaultsResult.error}
            />
          </Card>
        </div>
      )}

      {tab === "catalog" && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="shadow-sh border-ln">
            <ProductAdmin products={(products ?? []) as AdminProduct[]} />
          </Card>
        </div>
      )}

      {tab === "settings" && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="shadow-sh border-ln">
            <SettingsAdmin initial={settings} />
          </Card>

          <Card className="space-y-4 shadow-sh border-ln">
            <SectionHeader label="WhatsApp Message Templates" />
            <p className="text-caption text-t3 -mt-2">
              Meta API template status for automated customer communication dispatches.
            </p>

            <div className="divide-y divide-ln2 border border-ln rounded-card overflow-hidden bg-sf2">
              {TEMPLATES.map((t) => (
                <div key={t.name} className="flex items-center justify-between p-4 bg-sf hover:bg-sf2 transition-colors">
                  <div className="flex flex-col">
                    <span className="font-mono text-ui font-bold text-t1">{t.name}</span>
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
      )}
    </div>
  );
}
