"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import Button, { IconButton } from "@/components/ui/Button";
import { recordPayment } from "../payments/actions";

const KINDS = ["advance", "stage", "final", "refund"];
const MODES = ["cash", "upi", "bank", "cheque", "card"];
const FIELD =
  "w-full rounded-md border border-ln bg-sf2 px-3 py-2 text-[12.5px] text-t1 font-medium focus:border-acc focus:bg-sf focus:outline-none transition-all";

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
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="w-3.5 h-3.5" strokeWidth={2} />
        <span>Record Payment</span>
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-sf rounded-pop border border-ln shadow-shp max-w-lg w-full p-6 space-y-4 my-8 animate-popIn">
            <div className="flex items-center justify-between border-b border-ln2 pb-3">
              <div>
                <h3 className="text-section font-semibold text-t1">Record Payment</h3>
                <p className="text-caption text-t3 mt-0.5">Log a customer payment or refund entry</p>
              </div>
              <IconButton onClick={() => { setOpen(false); setError(null); }}>
                <X className="w-4 h-4" />
              </IconButton>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="mb-1 block text-caption font-semibold text-t2">Amount (₹)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`${FIELD} font-mono`}
                  placeholder="e.g. 15000"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-caption font-semibold text-t2">Date Paid</label>
                <input
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  className={FIELD}
                />
              </div>
              <div>
                <label className="mb-1 block text-caption font-semibold text-t2">Payment Type</label>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className={FIELD}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-caption font-semibold text-t2">Payment Mode</label>
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
              <label className="mb-1 block text-caption font-semibold text-t2">Reference / UTR (optional)</label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="UTR / Cheque / Ref number"
                className={FIELD}
              />
            </div>

            {kind === "refund" && (
              <p className="text-caption text-warn bg-warnS border border-warn/20 px-3 py-2 rounded-md">
                ⚠️ Refunds require owner/admin rights (enforced server-side).
              </p>
            )}

            {error && <p className="text-caption text-warn bg-warnS border border-warn/20 p-3 rounded-md">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-ln2">
              <Button
                variant="secondary"
                onClick={() => { setOpen(false); setError(null); }}
                disabled={isPending}
              >
                Cancel
              </Button>

              <Button
                variant="primary"
                onClick={submit}
                disabled={isPending}
              >
                {isPending ? "Recording..." : "Save Payment"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
