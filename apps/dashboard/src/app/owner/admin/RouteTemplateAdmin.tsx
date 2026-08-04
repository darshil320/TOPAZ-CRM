"use client";

/**
 * Route templates — reusable multi-workshop journeys (module 14, migration 0030).
 *
 * Exists so nobody retypes "Polishing 5 days at Sharma → Finishing 4 days at Main
 * Floor" on every order item. The allocate screen applies one in a single tap.
 *
 * VALIDATION IS SERVER-SIDE, and the messages here are the API's own, verbatim: the leg
 * spans must tile the stage chain with no gap and no overlap, and the last leg must
 * reach the final stage (services/route_plan.py). This form deliberately does NOT
 * duplicate those rules — a second copy of a validator is a second thing to drift.
 * What it does do is make the shape obvious: each row's "from" is prefilled with the
 * stage after the previous row's "to", so the valid plan is the one you get by default.
 */

import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, PowerOff, Route as RouteIcon, X } from "lucide-react";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
import type { RouteTemplate, StageDef } from "@/lib/production/types";
import { createRouteTemplate, deactivateRouteTemplate } from "./staffActions";

interface DraftLeg {
  workshop_id: string;
  stage_from: string;
  stage_to: string;
  planned_days: number;
}

const FIELD =
  "w-full rounded-md border border-ln bg-sf px-2.5 py-1.5 text-ui text-t1 focus:border-acc focus:outline-none";

export default function RouteTemplateAdmin({
  templates,
  workshops,
  stages,
  loadError,
}: {
  templates: RouteTemplate[];
  workshops: { id: string; name: string; active: boolean }[];
  stages: StageDef[];
  loadError: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [legs, setLegs] = useState<DraftLeg[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activeWorkshops = useMemo(() => workshops.filter((w) => w.active), [workshops]);
  const firstStage = stages[0]?.code ?? "";
  const lastStage = stages[stages.length - 1]?.code ?? "";

  function stageAfter(code: string): string {
    const index = stages.findIndex((s) => s.code === code);
    return index >= 0 && index + 1 < stages.length ? stages[index + 1].code : code;
  }

  function addLeg() {
    const previous = legs[legs.length - 1];
    // Prefill the contiguous choice: a new leg starts where the last one ended + 1 and
    // provisionally runs to the final stage, so a one-leg draft is already valid.
    const from = previous ? stageAfter(previous.stage_to) : firstStage;
    setLegs((prev) => [
      ...prev,
      {
        workshop_id: activeWorkshops[0]?.id ?? "",
        stage_from: from,
        stage_to: lastStage,
        planned_days: 5,
      },
    ]);
  }

  function updateLeg(index: number, patch: Partial<DraftLeg>) {
    setLegs((prev) => prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }

  function removeLeg(index: number) {
    setLegs((prev) => prev.filter((_, i) => i !== index));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createRouteTemplate(name, legs);
      if (res.error) {
        setError(res.error);
        return;
      }
      setShowForm(false);
      setName("");
      setLegs([]);
      // No router.refresh(): the action revalidates this page, so its own response
      // already carries the fresh tree. Refreshing too re-rendered the whole admin
      // page a second time per save.
    });
  }

  function deactivate(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deactivateRouteTemplate(id);
      if (res.error) {
        setError(res.error);
        return;
      }
    });
  }

  const stageLabel = (code: string) => {
    const stage = stages.find((s) => s.code === code);
    return stage ? stage.label_en : code;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionHeader label="Route Templates — multi-workshop journeys" />
          <p className="mt-1 text-caption text-t3">
            A saved sequence of workshops and day counts, applied to an order item in one tap
            on the allocate screen.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm((open) => !open);
            if (legs.length === 0) addLeg();
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-ln px-2.5 py-1.5 text-ui font-semibold text-t2 hover:text-t1"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? "Cancel" : "New route"}
        </button>
      </div>

      {(loadError || error) && (
        <div className="rounded-md border border-neg/30 bg-neg/10 p-3 text-caption font-semibold text-neg">
          {loadError ?? error}
        </div>
      )}

      {showForm && (
        <div className="space-y-3 rounded-card border border-ln bg-sf2 p-4">
          <input
            type="text"
            placeholder="Route name — e.g. Polish at Sharma, finish in-house"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD}
          />

          {legs.map((leg, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto_auto]">
              <select
                aria-label={`Leg ${index + 1} workshop`}
                value={leg.workshop_id}
                onChange={(e) => updateLeg(index, { workshop_id: e.target.value })}
                className={FIELD}
              >
                <option value="">Workshop…</option>
                {activeWorkshops.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>

              <select
                aria-label={`Leg ${index + 1} first stage`}
                value={leg.stage_from}
                onChange={(e) => updateLeg(index, { stage_from: e.target.value })}
                className={FIELD}
              >
                {stages.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label_en}
                  </option>
                ))}
              </select>

              <select
                aria-label={`Leg ${index + 1} last stage`}
                value={leg.stage_to}
                onChange={(e) => updateLeg(index, { stage_to: e.target.value })}
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
                value={leg.planned_days}
                onChange={(e) =>
                  updateLeg(index, { planned_days: Number(e.target.value) || 1 })
                }
                className={`${FIELD} font-mono tabular-nums w-20`}
              />

              <button
                type="button"
                onClick={() => removeLeg(index)}
                className="rounded-md border border-ln px-2 py-1.5 text-caption text-t2 hover:text-t1"
                aria-label={`Remove leg ${index + 1}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={addLeg}
              className="flex items-center gap-1.5 rounded-md border border-ln px-2.5 py-1.5 text-caption font-semibold text-t2 hover:text-t1"
            >
              <Plus className="h-3.5 w-3.5" /> Add leg
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={isPending || !name.trim() || legs.length === 0}
              className="flex items-center gap-1.5 rounded-md bg-acc px-3 py-1.5 text-ui font-semibold text-acc-fg disabled:opacity-40"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save route
            </button>
          </div>
          <p className="text-caption text-t3">
            The legs must cover the stage chain end to end with no gap and no overlap, and
            consecutive legs must be different workshops. The server checks this and will say
            exactly what is wrong.
          </p>
        </div>
      )}

      {templates.length === 0 ? (
        <p className="text-caption text-t3">
          No routes saved yet. Items can still be routed leg-by-leg on the allocate screen.
        </p>
      ) : (
        <div className="divide-y divide-ln2 overflow-hidden rounded-card border border-ln bg-sf2">
          {templates.map((template) => (
            <div key={template.id} className="space-y-2 bg-sf p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-ui font-semibold text-t1">
                  <RouteIcon className="h-4 w-4 text-acc" />
                  {template.name}
                </span>
                <div className="flex items-center gap-2">
                  <Pill tone="neutral">
                    {template.legs.length} leg{template.legs.length === 1 ? "" : "s"}
                  </Pill>
                  <button
                    type="button"
                    onClick={() => deactivate(template.id)}
                    disabled={isPending}
                    className="flex items-center gap-1.5 rounded-md border border-ln px-2 py-1 text-caption font-semibold text-t2 hover:text-t1 disabled:opacity-50"
                  >
                    <PowerOff className="h-3.5 w-3.5" /> Retire
                  </button>
                </div>
              </div>
              <ol className="space-y-1">
                {template.legs.map((leg) => (
                  <li key={leg.id} className="text-caption text-t2">
                    <span className="font-mono tabular-nums text-t3">{leg.seq}.</span>{" "}
                    <span className="font-semibold text-t1">{leg.workshop_name}</span> ·{" "}
                    {stageLabel(leg.stage_from)} → {stageLabel(leg.stage_to)} ·{" "}
                    <span className="font-mono tabular-nums">{leg.planned_days}d</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
