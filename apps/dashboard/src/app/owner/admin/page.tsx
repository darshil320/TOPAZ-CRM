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

export default async function AdminPage() {
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
    // production_stage_defs is read-open to every authenticated staff member (0024):
    // a stage label carries no money, and the route builder needs the codes + order.
    supabase
      .from("production_stage_defs")
      .select("code, sort, label_en, label_gu, photo_required, active")
      .eq("active", true)
      .order("sort"),
    listWorkshops(false),
    listRouteTemplates(false),
    // Via the API, not Supabase: `default_days` (0035) is only writable through
    // /api/stage-plan, so the read comes from the same place to avoid two shapes.
    listStageDefaults(),
  ]);

  // Rosters, one call per active workshop. Sequential-safe and small (a showroom has a
  // handful of sites), and the staff endpoint is the only money-blind path to the
  // roster + each person's phone number in one row.
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-28 sm:pb-8">
      <PageHeader
        title="System Admin"
        subtitle="Manage workshops & vendors, product catalog, quotation policies, and messaging templates"
      />

      {/* Workshops & Vendors Card */}
      <Card>
        <WorkshopAdmin
          workshops={workshopResult.workshops}
          managers={managerOptions}
          loadError={workshopResult.error}
          onAdd={addWorkshop}
          onUpdate={updateWorkshop}
          onDeactivate={deactivateWorkshop}
        />
      </Card>

      {/* Workshop Staff Card — the roster that decides who sees which queue (module 14) */}
      <Card>
        <WorkshopStaffAdmin
          workshops={staffWorkshops}
          staffOptions={managerOptions}
          loadError={rosterError}
        />
      </Card>

      {/* Route Templates Card — reusable multi-workshop journeys (module 14) */}
      <Card>
        <RouteTemplateAdmin
          templates={templateResult.data?.templates ?? []}
          workshops={workshopResult.workshops}
          stages={(stageRows ?? []) as StageDef[]}
          loadError={templateResult.error}
        />
      </Card>

      {/* Stage Durations Card — the day budget new schedules seed from (0035) */}
      <Card>
        <StagePlanAdmin
          stages={stageDefaultsResult.data?.stages ?? []}
          loadError={stageDefaultsResult.error}
        />
      </Card>

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
