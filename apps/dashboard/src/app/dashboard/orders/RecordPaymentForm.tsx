"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "../payments/actions";

const KINDS = ["advance", "stage", "final", "refund"];
const MODES = ["cash", "upi", "bank", "cheque", "card"];
const FIELD =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[16px] sm:text-xs text-slate-900 font-medium focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-2xs";

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
        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 text-xs font-bold transition-all shadow-2xs active:scale-95 shrink-0"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Record Payment
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 sm:p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Record New Payment</h4>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="text-xs font-bold text-slate-400 hover:text-slate-700"
        >
          &times; Close
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-600">Amount (₹)</label>
          <input type="number" inputMode="decimal" min="0" step="any" value={amount}
            onChange={(e) => setAmount(e.target.value)} className={FIELD} placeholder="e.g. 15000" autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-600">Date Paid</label>
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-600">Payment Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={FIELD}>
            {KINDS.map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-600">Payment Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={FIELD}>
            {MODES.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-600">Reference / UTR (optional)</label>
        <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
          placeholder="UTR / Cheque / Ref number" className={FIELD} />
      </div>
      {kind === "refund" && (
        <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
          ⚠️ Refunds require owner/admin rights (enforced server-side).
        </p>
      )}
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={submit} disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-xs font-bold transition-all shadow-2xs active:scale-95 disabled:opacity-60">
          {isPending ? "Recording..." : "Save Payment"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={isPending}
          className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
