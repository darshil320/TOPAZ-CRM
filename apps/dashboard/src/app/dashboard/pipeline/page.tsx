import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import PipelineBoard, { type BoardCard } from "./PipelineBoard";
import { BOARD_STAGES, STAGE_LABELS } from "./stages";

function ageInDays(iso: string | null): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

export default async function PipelinePage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const supabase = await createServerSupabaseClient();
  // Filtered to the board's own stages IN THE QUERY, not after it. This was fetching
  // 500 rows of any stage and discarding the off-board ones in JS, so once a shop has
  // 500+ closed deals the limit is spent on `won`/`lost` rows the board never shows
  // and live cards silently fall off it. Cheaper and correct.
  const { data: rows } = await supabase
    .from("pipeline_stages")
    .select("stage, updated_at, customers(id, name, primary_interest)")
    .in("stage", [...BOARD_STAGES])
    .limit(500);

  const cards: BoardCard[] = (rows ?? [])
    .map((r) => {
      const c = Array.isArray(r.customers) ? r.customers[0] : r.customers;
      return {
        customerId: c?.id ?? "",
        name: c?.name ?? "Unknown",
        subtitle: c?.primary_interest ?? null,
        stage: r.stage,
        ageDays: ageInDays(r.updated_at),
      };
    })
    .filter((c) => c.customerId);

  const columns = BOARD_STAGES.map((s) => ({ stage: s, label: STAGE_LABELS[s] ?? s }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pipeline Board"
        subtitle={`Drag cards between stages (desktop) · tap to expand (mobile) · ${cards.length} in pipeline`}
      />
      <PipelineBoard columns={columns} cards={cards} />
    </div>
  );
}
