"use client";

/**
 * AssignModal — pick a workshop + optional due date for one unallocated item.
 *
 * Deliberately NOT optimistic. Allocation can legitimately fail (inactive
 * workshop, order no longer confirmed, a concurrent allocation), and the API's
 * 409/422 `detail` is the operator's instruction. Showing a fake success and
 * rolling it back would hide exactly the message they need.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Factory } from "lucide-react";
import Button, { IconButton } from "@/components/ui/Button";
import StageScheduleEditor from "@/components/production/StageScheduleEditor";
import { allocateItem } from "./actions";

const FIELD =
  "w-full rounded-md border border-ln bg-sf2 px-3 py-2 text-[12.5px] text-t1 font-medium focus:border-acc focus:bg-sf focus:outline-none transition-all";

export interface WorkshopOption {
  id: string;
  name: string;
  type: string;
  openItemCount: number;
}

export interface AssignModalProps {
  itemId: string;
  itemDescription: string;
  orderNo: string;
  customerName: string;
  workshops: WorkshopOption[];
  /** Today in the showroom's locale, YYYY-MM-DD. Server-supplied so SSR and the
   *  client agree and `min` matches the API's own past-date rule. */
  todayISO: string;
}

export default function AssignModal({
  itemId,
  itemDescription,
  orderNo,
  customerName,
  workshops,
  todayISO,
}: AssignModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [workshopId, setWorkshopId] = useState("");
  const [dueDate, setDueDate] = useState("");
  /**
   * Step 2, shown only AFTER the item is allocated (0035). It has to be after: the
   * schedule is seeded from the admin defaults by the allocate endpoint itself, and it is
   * measured against the due date the operator just picked — so there is nothing
   * meaningful to edit before the allocation exists.
   */
  const [showSchedule, setShowSchedule] = useState(false);

  const selected = workshops.find((w) => w.id === workshopId) ?? null;

  function close() {
    setOpen(false);
    setShowSchedule(false);
    setError(null);
    router.refresh();
  }

  function submit() {
    setError(null);
    if (!workshopId) {
      setError("Pick a workshop first.");
      return;
    }
    if (dueDate && dueDate < todayISO) {
      setError("Due date is in the past — pick today or later.");
      return;
    }

    startTransition(async () => {
      const result = await allocateItem(itemId, workshopId, dueDate || null);
      if (result.error) {
        // Verbatim: the API's 409/422 detail tells the operator what to do next.
        setError(result.error);
        return;
      }
      // Stay open on the schedule step rather than closing: the allocation succeeded, and
      // the day budget is the thing the operator came here to set that they cannot set
      // anywhere else in this flow. Closing is one tap away.
      setShowSchedule(true);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} disabled={workshops.length === 0}>
        <Factory className="w-3.5 h-3.5" strokeWidth={2} />
        <span>Allocate</span>
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm animate-in fade-in duration-200 ease-out">
          <div className="w-full max-w-lg rounded-2xl border border-ln bg-sf p-6 shadow-2xl animate-in zoom-in-95 duration-200 ease-out" style={{ transformOrigin: "center" }}>
            <div className="flex items-start justify-between gap-3 border-b border-ln2 pb-3">
              <div className="min-w-0">
                <h3 className="text-section font-semibold text-t1">
                  {showSchedule ? "Stage schedule" : "Allocate to a workshop"}
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

            {showSchedule ? (
              <>
                <p className="rounded-md border border-pos/20 bg-posS px-3 py-2 text-caption font-semibold text-pos">
                  Allocated to {selected?.name ?? "the workshop"}. Set the day budget per
                  stage — or close and leave the seeded schedule as it is.
                </p>
                <StageScheduleEditor orderItemId={itemId} onSaved={close} />
                <div className="flex items-center justify-end pt-1">
                  <Button type="button" variant="secondary" onClick={close}>
                    Done
                  </Button>
                </div>
              </>
            ) : (
              <>
            <div>
              <label htmlFor="allocate-workshop" className="mb-1 block text-caption font-semibold text-t2">
                Workshop
              </label>
              <select
                id="allocate-workshop"
                value={workshopId}
                onChange={(e) => setWorkshopId(e.target.value)}
                className={FIELD}
              >
                <option value="">Select a workshop…</option>
                {workshops.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {w.type} · {w.openItemCount} open
                  </option>
                ))}
              </select>
              {selected && (
                <p className="mt-1 text-[11px] text-t3">
                  Currently holding{" "}
                  <span className="font-mono tabular-nums text-t2">{selected.openItemCount}</span>{" "}
                  unfinished item{selected.openItemCount === 1 ? "" : "s"}.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="allocate-due" className="mb-1 block text-caption font-semibold text-t2">
                Due date (optional)
              </label>
              <input
                id="allocate-due"
                type="date"
                min={todayISO}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={`${FIELD} font-mono tabular-nums`}
              />
              <p className="mt-1 text-[11px] text-t3">Leave blank if the workshop sets its own date.</p>
            </div>

            {error && (
              <p className="rounded-md border border-warn/20 bg-warnS px-3 py-2 text-caption font-semibold text-warn">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={close} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={submit} disabled={isPending || !workshopId}>
                {isPending ? "Allocating…" : "Allocate item"}
              </Button>
            </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
