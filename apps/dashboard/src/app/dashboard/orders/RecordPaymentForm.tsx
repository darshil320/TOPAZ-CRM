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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-xs font-bold transition-all shadow-xs active:scale-95 shrink-0"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        + Record Payment
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900">Record Payment</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">Log a customer payment or refund entry</p>
              </div>
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null); }}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center font-bold text-base transition-colors"
              >
                &times;
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Amount (₹)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={FIELD}
                  placeholder="e.g. 15000"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Date Paid</label>
                <input
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  className={FIELD}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Payment Type</label>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className={FIELD}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Payment Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value)} className={FIELD}>
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Reference / UTR (optional)</label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="UTR / Cheque / Ref number"
                className={FIELD}
              />
            </div>

            {kind === "refund" && (
              <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3.5 py-2 rounded-2xl">
                ⚠️ Refunds require owner/admin rights (enforced server-side).
              </p>
            )}

            {error && <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 p-3 rounded-2xl">{error}</p>}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null); }}
                disabled={isPending}
                className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 text-xs font-bold transition-all shadow-md shadow-blue-500/20 active:scale-95 disabled:opacity-60"
              >
                {isPending ? "Recording..." : "Save Payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
