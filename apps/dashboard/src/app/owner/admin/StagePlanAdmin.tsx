"use client";

/**
 * Stage durations — how many days each production stage should take (0035).
 *
 * This is the ADMIN DEFAULT, not a per-item schedule. Every newly-allocated item seeds
 * its schedule from these numbers; the owner then edits that item's copy on the allocate
 * screen if this particular sofa is different. Changing a number here therefore affects
 * FUTURE allocations only — existing schedules are left alone, because silently
 * re-planning work already underway would move deadlines people have committed to.
 *
 * A stage with no number is "not costed": a seeded schedule marks it SKIPPED rather than
 * inventing a duration for it (services/stage_plan.seed_from_defaults). That is why the
 * empty field is a legitimate saved state and not a validation error.
 */

import { useMemo, useState, useTransition } from "react";
import { CalendarClock, Check, Loader2 } from "lucide-react";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
import type { StageDefWithDefault } from "@/lib/production/types";
import { setStageDefaultDaysAction } from "@/lib/production/stagePlanActions";

const FIELD =
  "w-20 rounded-md border border-ln bg-sf px-2.5 py-1.5 text-ui font-mono tabular-nums text-t1 focus:border-acc focus:outline-none";

export default function StagePlanAdmin({
  stages,
  loadError,
}: {
  stages: StageDefWithDefault[];
  loadError: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(stages.map((s) => [s.code, s.default_days?.toString() ?? ""])),
  );
  const [error, setError] = useState<string | null>(null);
  const [savedCode, setSavedCode] = useState<string | null>(null);

  const totalDays = useMemo(
    () =>
      stages.reduce((sum, s) => {
        const value = Number.parseInt(draft[s.code] ?? "", 10);
        return sum + (Number.isFinite(value) && value > 0 ? value : 0);
      }, 0),
    [stages, draft],
  );

  const dirty = (code: string) => {
    const original = stages.find((s) => s.code === code)?.default_days ?? null;
    const typed = draft[code]?.trim() ?? "";
    const parsed = typed === "" ? null : Number.parseInt(typed, 10);
    return (original ?? null) !== (Number.isFinite(parsed as number) ? parsed : null);
  };

  function save(code: string) {
    const typed = draft[code]?.trim() ?? "";
    const parsed = typed === "" ? null : Number.parseInt(typed, 10);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 1)) {
      setError("Days must be a whole number of at least 1 — leave it blank for 'not costed'.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await setStageDefaultDaysAction(code, parsed);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSavedCode(code);
      // No router.refresh(): the action revalidates this page, so its own response
      // already carries the fresh tree. Refreshing too re-rendered the whole admin
      // page a second time per save.
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionHeader label="Stage durations" />
          <p className="text-caption text-t3 mt-1 max-w-2xl">
            The default number of days each stage should take. New items seed their
            schedule from these; existing schedules are not changed. Leave a stage blank
            if it does not usually apply — a seeded schedule marks those as skipped.
          </p>
        </div>
        <Pill tone={totalDays > 0 ? "pos" : "neutral"} dot={false}>
          <span className="font-mono tabular-nums">{totalDays}</span> day
          {totalDays === 1 ? "" : "s"} end to end
        </Pill>
      </div>

      {loadError && <p className="text-caption text-warn">{loadError}</p>}
      {error && <p className="text-caption text-warn">{error}</p>}

      <div className="divide-y divide-ln2 border border-ln rounded-card overflow-hidden bg-sf2">
        {stages.map((stage) => (
          <div
            key={stage.code}
            className="flex items-center justify-between gap-3 bg-sf p-3.5 hover:bg-sf2 transition-colors"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-ui font-semibold text-t1">{stage.label_en}</span>
                {stage.label_gu && (
                  <span className="text-caption text-t3">{stage.label_gu}</span>
                )}
                {stage.photo_required && (
                  <Pill tone="neutral" dot={false}>
                    photo
                  </Pill>
                )}
              </div>
              <span className="text-caption text-t3 font-mono">{stage.code}</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <label className="sr-only" htmlFor={`days-${stage.code}`}>
                Default days for {stage.label_en}
              </label>
              <input
                id={`days-${stage.code}`}
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                placeholder="—"
                value={draft[stage.code] ?? ""}
                onChange={(e) => {
                  setSavedCode(null);
                  setDraft((prev) => ({ ...prev, [stage.code]: e.target.value }));
                }}
                className={FIELD}
              />
              <span className="text-caption text-t3">days</span>
              <button
                type="button"
                onClick={() => save(stage.code)}
                disabled={isPending || !dirty(stage.code)}
                className="rounded-md border border-ln px-2.5 py-1.5 text-caption font-semibold text-t2 hover:bg-sf2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPending && dirty(stage.code) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                ) : savedCode === stage.code ? (
                  <Check className="h-3.5 w-3.5 text-pos" strokeWidth={2.4} />
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-caption text-t3 flex items-start gap-1.5">
        <CalendarClock className="h-3.5 w-3.5 shrink-0 mt-px text-t3" strokeWidth={1.8} />
        <span>
          A stage that runs past its deadline sends one WhatsApp to the workshop lead and
          the owner, and shows a red pill on the workshop app. Never more than one per
          stage — snoozing on the phone is what asks for a second.
        </span>
      </p>
    </div>
  );
}
