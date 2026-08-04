"use client";

/**
 * StageScheduleEditor — one item's per-stage day budget (0035).
 *
 * Used from two places, which is why it loads its own data: the allocate modal (right
 * after an item gets a workshop and a due date) and the production board's drawer (to
 * re-plan later). Neither caller knows which item will be clicked when the page renders,
 * so threading the plan down as a prop would mean fetching every item's schedule up front.
 *
 * ─── THE FOOTER IS THE FEATURE ───────────────────────────────────────────────
 * The live `used / budget` counter is what stops the operator discovering the overrun on
 * Save. It turns red with the exact overshoot, and Save is disabled while it is red.
 *
 * The arithmetic here is a MIRROR, not the authority: services/stage_plan.validate_plan
 * re-checks everything server-side on every PUT (a Server Action is callable RPC), and
 * also enforces the rule this component cannot see — no stage may finish after the route
 * leg that owns it is due to hand the goods on.
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react";
import type { StageDefWithDefault, StagePlanRow } from "@/lib/production/types";
import {
  loadStagePlanAction,
  saveStagePlanAction,
  type StagePlanInputRow,
} from "@/lib/production/stagePlanActions";

interface DraftRow {
  stage_code: string;
  label_en: string;
  label_gu: string | null;
  days: string;
  skipped: boolean;
  remind: boolean;
}

const FIELD =
  "w-16 rounded-md border border-ln bg-sf px-2 py-1 text-ui font-mono tabular-nums text-t1 focus:border-acc focus:outline-none disabled:opacity-40";

function toDraft(stages: StageDefWithDefault[], plan: StagePlanRow[]): DraftRow[] {
  const byCode = new Map(plan.map((p) => [p.stage_code, p]));
  return stages.map((stage) => {
    const row = byCode.get(stage.code);
    // No plan row yet? Fall back to the admin default, marking a stage the owner has not
    // costed as skipped — the same rule the server seeds with, so the first thing the
    // operator sees matches what an untouched item would have got.
    const fallbackDays = stage.default_days;
    return {
      stage_code: stage.code,
      label_en: stage.label_en,
      label_gu: stage.label_gu,
      days: row
        ? row.planned_days?.toString() ?? ""
        : fallbackDays?.toString() ?? "",
      skipped: row ? row.skipped : !fallbackDays,
      remind: row ? row.remind : Boolean(fallbackDays),
    };
  });
}

function parseDays(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function StageScheduleEditor({
  orderItemId,
  orderId,
  onSaved,
}: {
  orderItemId: string;
  orderId?: string;
  /** Called after a successful save, so the caller can close its modal or refresh. */
  onSaved?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [budgetDays, setBudgetDays] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await loadStagePlanAction(orderItemId);
    if (res.error || !res.plan) {
      setError(res.error ?? "Could not load this schedule");
      setLoading(false);
      return;
    }
    setRows(toDraft(res.plan.stages, res.plan.plan));
    setBudgetDays(res.plan.budget_days);
    setDueDate(res.plan.due_date);
    setError(null);
    setLoading(false);
  }, [orderItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const usedDays = useMemo(
    () => rows.reduce((sum, r) => (r.skipped ? sum : sum + (parseDays(r.days) ?? 0)), 0),
    [rows],
  );
  const overshoot = budgetDays === null ? 0 : Math.max(0, usedDays - budgetDays);
  const liveRows = rows.filter((r) => !r.skipped);
  const missingDays = liveRows.some((r) => parseDays(r.days) === null);
  const canSave = !isPending && !loading && overshoot === 0 && !missingDays && liveRows.length > 0;

  function update(code: string, patch: Partial<DraftRow>) {
    setSaved(false);
    setErrors([]);
    setRows((prev) => prev.map((r) => (r.stage_code === code ? { ...r, ...patch } : r)));
  }

  function submit() {
    setError(null);
    setErrors([]);
    const payload: StagePlanInputRow[] = rows.map((r) => ({
      stage_code: r.stage_code,
      planned_days: r.skipped ? null : parseDays(r.days),
      skipped: r.skipped,
      remind: r.remind,
    }));

    startTransition(async () => {
      const res = await saveStagePlanAction(orderItemId, payload, orderId);
      if (res.error) {
        setError(res.error);
        setErrors(res.errors ?? []);
        return;
      }
      setSaved(true);
      onSaved?.();
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-caption text-t3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        <span>Loading the stage schedule…</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1.5 text-caption text-t3">
        <CalendarClock className="h-3.5 w-3.5 shrink-0 mt-px" strokeWidth={1.8} />
        <span>
          Days per stage. Skip the ones that do not apply to this item; turn off Remind for
          work you do not want a WhatsApp about.
          {dueDate && (
            <>
              {" "}
              Due <span className="font-mono tabular-nums text-t2">{dueDate}</span>.
            </>
          )}
        </span>
      </div>

      <div className="divide-y divide-ln2 overflow-hidden rounded-card border border-ln bg-sf2">
        {rows.map((row) => (
          <div
            key={row.stage_code}
            className={`flex items-center justify-between gap-3 p-2.5 ${row.skipped ? "bg-sf2 opacity-60" : "bg-sf"}`}
          >
            <div className="min-w-0">
              <span className="text-ui font-medium text-t1">{row.label_en}</span>
              {row.label_gu && <span className="ml-1.5 text-caption text-t3">{row.label_gu}</span>}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <input
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                aria-label={`Days for ${row.label_en}`}
                placeholder="—"
                value={row.days}
                disabled={row.skipped}
                onChange={(e) => update(row.stage_code, { days: e.target.value })}
                className={FIELD}
              />
              <label className="flex items-center gap-1 text-caption text-t2">
                <input
                  type="checkbox"
                  checked={row.skipped}
                  onChange={(e) =>
                    // Clearing the day count on skip keeps the draft honest: a skipped
                    // stage with a leftover number is what the DB check refuses (0035).
                    update(row.stage_code, {
                      skipped: e.target.checked,
                      days: e.target.checked ? "" : row.days,
                    })
                  }
                />
                Skip
              </label>
              <label className="flex items-center gap-1 text-caption text-t2">
                <input
                  type="checkbox"
                  checked={row.remind}
                  disabled={row.skipped}
                  onChange={(e) => update(row.stage_code, { remind: e.target.checked })}
                />
                Remind
              </label>
            </div>
          </div>
        ))}
      </div>

      {/* The live counter. Sticky inside the modal body so it stays visible while the
          operator scrolls eleven rows. */}
      <div
        className={`sticky bottom-0 flex items-center justify-between gap-3 rounded-card border px-3 py-2 text-caption font-semibold ${
          overshoot > 0
            ? "border-warn/40 bg-warnS text-warn"
            : "border-ln bg-sf2 text-t2"
        }`}
      >
        <span className="font-mono tabular-nums">
          {usedDays} / {budgetDays ?? "∞"} days
        </span>
        {overshoot > 0 ? (
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            {overshoot} day{overshoot === 1 ? "" : "s"} over the due date — remove {overshoot}
          </span>
        ) : missingDays ? (
          <span>Every stage that is not skipped needs at least 1 day</span>
        ) : (
          <span className="text-t3">
            {budgetDays === null
              ? "No due date set — reminders only"
              : `${budgetDays - usedDays} day(s) spare`}
          </span>
        )}
      </div>

      {error && (
        <div className="space-y-1 rounded-md border border-warn/20 bg-warnS px-3 py-2">
          <p className="text-caption font-semibold text-warn">{error}</p>
          {errors.length > 1 &&
            errors.slice(1).map((e) => (
              <p key={e} className="text-caption text-warn">
                {e}
              </p>
            ))}
        </div>
      )}
      {saved && !error && (
        <p className="text-caption font-semibold text-pos">Schedule saved.</p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          className="rounded-md bg-acc px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save schedule"}
        </button>
      </div>
    </div>
  );
}
