"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSetting } from "./actions";

export interface AdminSettings {
  quote_terms: string;
  quote_validity_days: number;
  default_advance_pct: number;
  send_receipts_to_customer: boolean;
}

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function SettingsAdmin({ initial }: { initial: AdminSettings }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState(initial);

  const save = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const results = await Promise.all([
        saveSetting("quote_terms", s.quote_terms),
        saveSetting("quote_validity_days", Number(s.quote_validity_days)),
        saveSetting("default_advance_pct", Number(s.default_advance_pct)),
        saveSetting("send_receipts_to_customer", s.send_receipts_to_customer),
      ]);
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        setError(failed.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs text-slate-500">Default quote terms</label>
        <textarea rows={3} className={FIELD} value={s.quote_terms}
          onChange={(e) => setS({ ...s, quote_terms: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Quote validity (days)</label>
          <input type="number" className={FIELD} value={s.quote_validity_days}
            onChange={(e) => setS({ ...s, quote_validity_days: Number(e.target.value) })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Default advance %</label>
          <input type="number" className={FIELD} value={s.default_advance_pct}
            onChange={(e) => setS({ ...s, default_advance_pct: Number(e.target.value) })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={s.send_receipts_to_customer}
          onChange={(e) => setS({ ...s, send_receipts_to_customer: e.target.checked })} />
        Send payment receipts to the customer on WhatsApp
      </label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={isPending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {isPending ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-xs text-green-600">Saved ✓</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      <p className="text-[11px] text-slate-400">
        Note: some settings are also read from server env at runtime; align them with a deploy.
      </p>
    </div>
  );
}
