"use client";

/**
 * Unclaimed walk-ins — the same people every salesperson sees in their walk-in queue
 * (0052 leaves that queue as it was). The front desk can hand any of them straight to a
 * salesperson; assigning makes that salesperson the primary, so the row leaves every
 * queue, this one included.
 */

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { FIELD } from "@/app/dashboard/leads/LeadForm";
import { formatDate } from "@/lib/format";
import { assignWalkinAction } from "./actions";

export interface SellerOption {
  id: string;
  name: string;
}

export interface DispatchRow {
  id: string;
  name: string | null;
  phone: string | null;
  interest: string | null;
  createdAt: string;
}

function Row({ row, sellers }: { row: DispatchRow; sellers: SellerOption[] }) {
  const [error, setError] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function assign(e: React.ChangeEvent<HTMLSelectElement>) {
    const salespersonId = e.target.value;
    if (!salespersonId) return;
    setError(null);
    start(async () => {
      const res = await assignWalkinAction(row.id, salespersonId);
      if (res.error) setError(res.error);
      else setAssignedTo(res.assignedTo ?? null);
    });
  }

  return (
    <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5">
      <div className="min-w-0">
        <span className="font-semibold text-ui text-t1 truncate">{row.name ?? "Unknown"}</span>
        <p className="text-caption text-t3 mt-0.5">
          {row.phone && <span className="font-mono tabular-nums">{row.phone}</span>}
          {row.interest && ` · ${row.interest}`}
          {" · "}
          <span className="font-mono tabular-nums">{formatDate(row.createdAt)}</span>
        </p>
        {error && <p className="text-caption text-neg mt-1">{error}</p>}
      </div>
      {assignedTo ? (
        <span className="text-caption font-semibold text-pos">Assigned to {assignedTo}</span>
      ) : (
        <select
          aria-label={`Assign ${row.name ?? "this walk-in"} to a salesperson`}
          className={`${FIELD} sm:w-56`}
          defaultValue=""
          onChange={assign}
          disabled={pending}
        >
          <option value="" disabled>Assign to…</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
    </Card>
  );
}

export default function WalkinDispatchList({
  rows,
  sellers,
}: {
  rows: DispatchRow[];
  sellers: SellerOption[];
}) {
  if (rows.length === 0) {
    return (
      <Card className="py-10 text-center">
        <p className="text-body font-semibold text-t1">Nobody waiting</p>
        <p className="text-caption text-t3 mt-1">Every walk-in has been claimed or assigned.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <Row key={row.id} row={row} sellers={sellers} />
      ))}
    </div>
  );
}
