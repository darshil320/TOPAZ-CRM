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
  const { data: rows } = await supabase
    .from("pipeline_stages")
    .select("stage, updated_at, customers(id, name, primary_interest)")
    .limit(500);

  const onBoard = new Set<string>(BOARD_STAGES);
  const cards: BoardCard[] = (rows ?? [])
    .filter((r) => onBoard.has(r.stage))
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
