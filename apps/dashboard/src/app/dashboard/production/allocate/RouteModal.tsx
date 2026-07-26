"use client";

/**
 * RouteModal — plan an item's whole multi-workshop journey (module 14).
 *
 * The sibling of AssignModal: that one sends an item to ONE workshop, this one lays out
 * the sequence the client described — "polishing in one workshop within 5 days then to
 * finishing up to another workshop within 4 days".
 *
 * Two ways in, because they suit different moments:
 *   · **a saved route** (one tap, the common case), or
 *   · **leg by leg**, for the piece that does not fit any template.
 *
 * NOT OPTIMISTIC, and it does not re-implement the validator. The API refuses a plan
 * that leaves a gap in the stage chain, doubles back, or stops short of the final stage,
 * and its message names the leg and the stage. Mirroring those rules here would be a
 * second copy to drift; what this form does instead is DEFAULT to a valid shape — each
 * new leg starts at the stage after the previous one ends.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Route as RouteIcon, X } from "lucide-react";
import Button, { IconButton } from "@/components/ui/Button";
import type { RouteTemplate, StageDef } from "@/lib/production/types";
import { planRoute, type RouteLegInput } from "./actions";
import type { WorkshopOption } from "./AssignModal";

const FIELD =
  "w-full rounded-md border border-ln bg-sf2 px-3 py-2 text-[12.5px] text-t1 font-medium focus:border-acc focus:bg-sf focus:outline-none transition-all";

interface DraftLeg {
  workshopId: string;
  stageFrom: string;
  stageTo: string;
  days: number;
}

export default function RouteModal({
  itemId,
  itemDescription,
  orderNo,
  customerName,
  workshops,
  stages,
  templates,
  todayISO,
}: {
  itemId: string;
  itemDescription: string;
  orderNo: string;
  customerName: string;
  workshops: WorkshopOption[];
  stages: StageDef[];
  templates: RouteTemplate[];
  todayISO: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState(todayISO);
  const [legs, setLegs] = useState<DraftLeg[]>([]);

  const firstStage = stages[0]?.code ?? "";
  const lastStage = stages[stages.length - 1]?.code ?? "";

  const usableTemplates = useMemo(
    () => templates.filter((t) => t.active && t.legs.length > 0),
    [templates],
  );

  function stageAfter(code: string): string {
    const index = stages.findIndex((s) => s.code === code);
    return index >= 0 && index + 1 < stages.length ? stages[index + 1].code : code;
  }

  function addLeg() {
    const previous = legs[legs.length - 1];
    const from = previous ? stageAfter(previous.stageTo) : firstStage;
    // Two consecutive legs at the same workshop is refused by the API (it would be a
    // consignment to where the goods already are), so default to a DIFFERENT site.
    const nextWorkshop =
      workshops.find((w) => w.id !== previous?.workshopId)?.id ?? workshops[0]?.id ?? "";
    setLegs((prev) => [
      ...prev,
      { workshopId: nextWorkshop, stageFrom: from, stageTo: lastStage, days: 5 },
    ]);
  }

  function updateLeg(index: number, patch: Partial<DraftLeg>) {
    setLegs((prev) => prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload: RouteLegInput[] = legs.map((leg) => ({
        workshop_id: leg.workshopId,
        stage_from: leg.stageFrom,
        stage_to: leg.stageTo,
        planned_days: leg.days,
      }));
      const result = await planRoute(itemId, {
        legs: templateId ? undefined : payload,
        templateId: templateId || undefined,
        // Midnight IST on the chosen day; the API stamps each leg's deadline at 18:00
        // IST that many days later.
        startAt: startDate ? `${startDate}T00:00:00+05:30` : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      close();
      setLegs([]);
      setTemplateId("");
      router.refresh();
    });
  }

  const canSubmit = templateId !== "" || (legs.length > 0 && legs.every((l) => l.workshopId));

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setOpen(true);
          if (legs.length === 0 && usableTemplates.length === 0) addLeg();
        }}
        disabled={workshops.length === 0}
      >
        <RouteIcon className="h-3.5 w-3.5" strokeWidth={2} />
        <span>Plan route</span>
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
          <div className="my-8 w-full max-w-2xl space-y-4 rounded-pop border border-ln bg-sf p-6 shadow-shp animate-popIn">
            <div className="flex items-start justify-between gap-3 border-b border-ln2 pb-3">
              <div className="min-w-0">
                <h3 className="text-section font-semibold text-t1">
                  Plan a multi-workshop route
                </h3>
                <p className="mt-0.5 truncate text-caption text-t3">
                  <span className="font-mono">{orderNo}</span> · {customerName}
                </p>
              </div>
              <IconButton type="button" aria-label="Close" onClick={close}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>

            <div className="rounded-card border border-ln bg-sf2 px-3 py-2.5">
              <p className="text-caption font-semibold text-t1">{itemDescription}</p>
            </div>

            {usableTemplates.length > 0 && (
              <div>
                <label htmlFor="route-template" className="mb-1 block text-caption font-semibold text-t2">
                  Saved route
                </label>
                <select
                  id="route-template"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className={FIELD}
                >
                  <option value="">Build it leg by leg…</option>
                  {usableTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.legs.length} leg{t.legs.length === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
                {templateId && (
                  <ol className="mt-2 space-y-1 rounded-card border border-ln bg-sf2 px-3 py-2">
                    {usableTemplates
                      .find((t) => t.id === templateId)
                      ?.legs.map((leg) => (
                        <li key={leg.id} className="text-caption text-t2">
                          <span className="font-mono tabular-nums text-t3">{leg.seq}.</span>{" "}
                          <span className="font-semibold text-t1">{leg.workshop_name}</span> ·{" "}
                          <span className="font-mono tabular-nums">{leg.planned_days}d</span>
                        </li>
                      ))}
                  </ol>
                )}
              </div>
            )}

            <div>
              <label htmlFor="route-start" className="mb-1 block text-caption font-semibold text-t2">
                Production starts
              </label>
              <input
                id="route-start"
                type="date"
                min={todayISO}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`${FIELD} font-mono tabular-nums`}
              />
              <p className="mt-1 text-[11px] text-t3">
                Each leg&apos;s deadline is this date plus the days so far, at 6:00 PM IST.
                Five days polishing then four finishing means the second workshop is due on
                day nine, not day four.
              </p>
            </div>

            {!templateId && (
              <div className="space-y-2">
                <div className="grid gap-2 text-label uppercase text-t3 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                  <span>Workshop</span>
                  <span>From stage</span>
                  <span>To stage</span>
                  <span>Days</span>
                </div>

                {legs.map((leg, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto_auto]">
                    <select
                      aria-label={`Leg ${index + 1} workshop`}
                      value={leg.workshopId}
                      onChange={(e) => updateLeg(index, { workshopId: e.target.value })}
                      className={FIELD}
                    >
                      <option value="">Select…</option>
                      {workshops.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} · {w.openItemCount} open
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Leg ${index + 1} from stage`}
                      value={leg.stageFrom}
                      onChange={(e) => updateLeg(index, { stageFrom: e.target.value })}
                      className={FIELD}
                    >
                      {stages.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.label_en}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Leg ${index + 1} to stage`}
                      value={leg.stageTo}
                      onChange={(e) => updateLeg(index, { stageTo: e.target.value })}
                      className={FIELD}
                    >
                      {stages.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.label_en}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      aria-label={`Leg ${index + 1} days`}
                      value={leg.days}
                      onChange={(e) => updateLeg(index, { days: Number(e.target.value) || 1 })}
                      className={`${FIELD} w-20 font-mono tabular-nums`}
                    />
                    <IconButton
                      type="button"
                      aria-label={`Remove leg ${index + 1}`}
                      onClick={() => setLegs((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <X className="h-4 w-4" />
                    </IconButton>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addLeg}
                  className="flex items-center gap-1.5 rounded-md border border-ln px-2.5 py-1.5 text-caption font-semibold text-t2 hover:text-t1"
                >
                  <Plus className="h-3.5 w-3.5" /> Add leg
                </button>
              </div>
            )}

            {error && (
              <p className="rounded-md border border-warn/20 bg-warnS px-3 py-2 text-caption font-semibold text-warn">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={close} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={submit} disabled={isPending || !canSubmit}>
                {isPending ? "Planning…" : "Plan route"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
