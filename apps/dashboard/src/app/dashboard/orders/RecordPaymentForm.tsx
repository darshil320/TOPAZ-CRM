"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "../payments/actions";

const KINDS = ["advance", "stage", "final", "refund"];
const MODES = ["cash", "upi", "bank", "cheque", "card"];
const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function RecordPaymentForm({ orderId, defaultDate }: { orderId: string; defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("advance");
  const [mode, setMode] = useState("upi");
  const [paidAt, setPaidAt] = useState(defaultDate);
  const [reference, setReference] = useState("");

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await recordPayment({ orderId, kind, amount, mode, paidAt, reference });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setAmount("");
      setReference("");
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
      >
        Record payment
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Amount (₹)</label>
          <input type="number" inputMode="decimal" min="0" step="any" value={amount}
            onChange={(e) => setAmount(e.target.value)} className={FIELD} autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Date</label>
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={FIELD}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={FIELD}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">Reference (optional)</label>
        <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
          placeholder="UTR / cheque no." className={FIELD} />
      </div>
      {kind === "refund" && (
        <p className="text-[11px] text-amber-600">Refunds require owner/admin rights (enforced server-side).</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={isPending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {isPending ? "Recording…" : "Save payment"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={isPending}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700">
          Cancel
        </button>
      </div>
    </div>
  );
}
