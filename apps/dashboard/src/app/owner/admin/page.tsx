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
import { listRouteTemplates, listStageDefaults, listWorkshopStaff } from "@/lib/production/reads";
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
  const [
    { data: products },
    { data: settingsRows },
    { data: salespersons },
    { data: stageRows },
    workshopResult,
    templateResult,
    stageDefaultsResult,
  ] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, category, hsn, gst_rate, base_price, unit, active, primary_media_id")
      .order("name"),
    supabase.from("app_settings").select("key, value"),
    supabase.from("salespersons").select("id, name, role").eq("active", true).order("name"),
    supabase
      .from("production_stage_defs")
      .select("code, sort, label_en, label_gu, photo_required, active")
      .eq("active", true)
      .order("sort"),
    listWorkshops(false),
    listRouteTemplates(false),
    listStageDefaults(),
  ]);

  const activeWorkshops = workshopResult.workshops.filter((w) => w.active);
  const rosters = await Promise.all(
    activeWorkshops.map(async (w) => ({
      workshop: w,
      result: await listWorkshopStaff(w.id),
    })),
  );
  const staffWorkshops: StaffWorkshop[] = rosters.map(({ workshop, result }) => ({
    id: workshop.id,
    name: workshop.name,
    type: workshop.type,
    active: workshop.active,
    staff: result.data?.staff ?? [],
  }));
  const rosterError = rosters.find(({ result }) => result.error)?.result.error ?? null;

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
