"use client";

/**
 * Workshop staff roster — the intake path for the lead / sub-manager hierarchy
 * (module 14, migration 0029).
 *
 * WHY THIS SCREEN MATTERS OPERATIONALLY: `is_workshop_manager_of()` reads the ROSTER,
 * not `workshops.manager_salesperson_id` (which is now a denorm of it). A manager who
 * is not on a roster here sees an empty queue in the workshop app, no matter what the
 * workshop record says. This tab is the only way in.
 *
 * The capability split shown to the operator is the real one, enforced by the API:
 *   LEAD — status updates AND custody (hand goods over, receive an incoming lorry)
 *   SUB  — status updates only
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Loader2, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import SectionHeader from "@/components/ui/SectionHeader";
import Pill from "@/components/ui/Pill";
import type { StaffRow } from "./staffActions";
import { appointStaff, removeStaff } from "./staffActions";

export interface StaffWorkshop {
  id: string;
  name: string;
  type: string;
  active: boolean;
  staff: StaffRow[];
}

export interface StaffOption {
  id: string;
  name: string | null;
  role: string | null;
}

const FIELD =
  "w-full rounded-md border border-ln bg-sf px-3 py-1.5 text-ui text-t1 placeholder-t3 focus:border-acc focus:outline-none";

/**
 * Roles that may hold a workshop post. `accounts` is excluded deliberately — a finance
 * user on a workshop roster would gain a production surface for no reason, and
 * `capabilities_for()` grants them nothing anyway, so the row would be dead weight that
 * merely looks like access.
 */
const ELIGIBLE_ROLES = new Set(["workshop_manager", "owner", "admin"]);

export default function WorkshopStaffAdmin({
  workshops,
  staffOptions,
  loadError,
}: {
  workshops: StaffWorkshop[];
  staffOptions: StaffOption[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rosters, setRosters] = useState<Record<string, StaffRow[]>>(
    Object.fromEntries(workshops.map((w) => [w.id, w.staff])),
  );
  const [pick, setPick] = useState<Record<string, { id: string; role: "lead" | "sub" }>>({});
  const [error, setError] = useState<string | null>(null);

  const eligible = staffOptions.filter((s) => ELIGIBLE_ROLES.has(s.role ?? ""));

  function selection(workshopId: string) {
    return pick[workshopId] ?? { id: "", role: "sub" as const };
  }

  function handleAppoint(workshopId: string) {
    const choice = selection(workshopId);
    setError(null);
    startTransition(async () => {
      const res = await appointStaff(workshopId, choice.id, choice.role);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.staff) setRosters((prev) => ({ ...prev, [workshopId]: res.staff! }));
      setPick((prev) => ({ ...prev, [workshopId]: { id: "", role: "sub" } }));
      router.refresh();
    });
  }

  function handleRemove(workshopId: string, salespersonId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeStaff(workshopId, salespersonId);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.staff) setRosters((prev) => ({ ...prev, [workshopId]: res.staff! }));
      router.refresh();
    });
  }

  const activeWorkshops = workshops.filter((w) => w.active);

  return (
    <div className="space-y-4">
      <SectionHeader label="Workshop Staff — leads & sub-managers" />
      <p className="-mt-2 text-caption text-t3">
        A <strong>lead</strong> updates stage status <em>and</em> moves custody (hands goods to
        the next workshop, receives an incoming lorry). A <strong>sub-manager</strong> updates
        stage status only. One lead per workshop; sub-managers unlimited.
      </p>

      {(loadError || error) && (
        <div className="rounded-md border border-neg/30 bg-neg/10 p-3 text-caption font-semibold text-neg">
          {loadError ?? error}
        </div>
      )}

      {activeWorkshops.length === 0 && !loadError && (
        <p className="text-caption text-t3">
          No active workshops yet — add one above first.
        </p>
      )}

      <div className="space-y-3">
        {activeWorkshops.map((workshop) => {
          const roster = rosters[workshop.id] ?? [];
          const lead = roster.find((r) => r.role === "lead");
          const subs = roster.filter((r) => r.role === "sub");
          const choice = selection(workshop.id);
          const alreadyOn = new Set(roster.map((r) => r.salesperson_id));

          return (
            <div key={workshop.id} className="rounded-card border border-ln bg-sf2 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-ui font-semibold text-t1">{workshop.name}</span>
                  <Pill tone="neutral">{workshop.type}</Pill>
                </div>
                <span className="font-mono text-caption text-t3 tabular-nums">
                  {roster.length} staff
                </span>
              </div>

              {/* The lead — the post that can accept goods */}
              <div className="flex items-center justify-between gap-3 rounded-md border border-ln bg-sf px-3 py-2">
                <span className="flex items-center gap-2 text-ui text-t1">
                  <Crown className="h-4 w-4 text-acc" />
                  {lead ? (
                    <>
                      <span className="font-semibold">{lead.salesperson_name}</span>
                      {lead.salesperson_whatsapp && (
                        <span className="font-mono text-caption text-t3">
                          {lead.salesperson_whatsapp}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-t3">
                      No lead — nobody here can receive an incoming consignment
                    </span>
                  )}
                </span>
                {lead && (
                  <button
                    type="button"
                    onClick={() => handleRemove(workshop.id, lead.salesperson_id)}
                    disabled={isPending}
                    className="flex items-center gap-1.5 rounded-md border border-ln px-2 py-1 text-caption font-semibold text-t2 hover:text-t1 disabled:opacity-50"
                  >
                    <UserMinus className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>

              {subs.length > 0 && (
                <ul className="divide-y divide-ln2 overflow-hidden rounded-md border border-ln bg-sf">
                  {subs.map((sub) => (
                    <li
                      key={sub.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="flex items-center gap-2 text-ui text-t1">
                        <ShieldCheck className="h-4 w-4 text-t3" />
                        <span>{sub.salesperson_name}</span>
                        {sub.salesperson_whatsapp && (
                          <span className="font-mono text-caption text-t3">
                            {sub.salesperson_whatsapp}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemove(workshop.id, sub.salesperson_id)}
                        disabled={isPending}
                        className="flex items-center gap-1.5 rounded-md border border-ln px-2 py-1 text-caption font-semibold text-t2 hover:text-t1 disabled:opacity-50"
                      >
                        <UserMinus className="h-3.5 w-3.5" /> Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Appoint */}
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <select
                  aria-label={`Add staff to ${workshop.name}`}
                  value={choice.id}
                  onChange={(e) =>
                    setPick((prev) => ({
                      ...prev,
                      [workshop.id]: { ...choice, id: e.target.value },
                    }))
                  }
                  className={FIELD}
                >
                  <option value="">Select staff…</option>
                  {eligible.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name ?? "Unnamed"}
                      {option.role ? ` · ${option.role}` : ""}
                      {alreadyOn.has(option.id) ? " (already on roster)" : ""}
                    </option>
                  ))}
                </select>

                <select
                  aria-label={`Role at ${workshop.name}`}
                  value={choice.role}
                  onChange={(e) =>
                    setPick((prev) => ({
                      ...prev,
                      [workshop.id]: { ...choice, role: e.target.value as "lead" | "sub" },
                    }))
                  }
                  className={FIELD}
                >
                  <option value="sub">Sub-manager</option>
                  <option value="lead">Lead (replaces current)</option>
                </select>

                <button
                  type="button"
                  onClick={() => handleAppoint(workshop.id)}
                  disabled={isPending || !choice.id}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-acc px-3 py-1.5 text-ui font-semibold text-acc-fg disabled:opacity-40"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  Appoint
                </button>
              </div>

              {eligible.length === 0 && (
                <p className="text-caption text-t3">
                  No eligible staff. Add a person with the <code>workshop_manager</code> role
                  under Salespersons first.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
