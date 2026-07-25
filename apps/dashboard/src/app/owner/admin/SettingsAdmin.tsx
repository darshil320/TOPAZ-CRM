"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSetting } from "./actions";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";

export interface AdminSettings {
  quote_terms: string;
  quote_validity_days: number;
  default_advance_pct: number;
  send_receipts_to_customer: boolean;
}

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
    <div className="space-y-4">
      <div>
        <SectionHeader label="Commercial & Quotation Policies" />
        <p className="text-caption text-t3 mt-0.5">
          Configure default commercial terms, validity windows, and payment notification preferences.
        </p>
      </div>

      <div className="space-y-4">
        {/* Quote Terms */}
        <div>
          <label className="block text-caption font-semibold text-t2 mb-1">
            Default Quotation Terms &amp; Conditions
          </label>
          <textarea
            rows={3}
            value={s.quote_terms}
            onChange={(e) => setS({ ...s, quote_terms: e.target.value })}
            className="w-full rounded-md border border-ln bg-sf px-3 py-2 text-ui text-t1 placeholder-t3 focus:border-acc focus:outline-none transition-all"
            placeholder="e.g. 50% advance; balance before delivery."
          />
          <p className="text-caption text-t3 mt-1">
            Prefilled at the bottom of all new customer quotations.
          </p>
        </div>

        {/* Validity & Advance Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-caption font-semibold text-t2 mb-1">
              Quotation Validity (Days)
            </label>
            <input
              type="number"
              value={s.quote_validity_days}
              onChange={(e) => setS({ ...s, quote_validity_days: Number(e.target.value) })}
              className="w-full rounded-md border border-ln bg-sf px-3 py-1.5 text-ui font-mono text-t1 focus:border-acc focus:outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-caption font-semibold text-t2 mb-1">
              Default Order Advance %
            </label>
            <div className="relative">
              <input
                type="number"
                value={s.default_advance_pct}
                onChange={(e) => setS({ ...s, default_advance_pct: Number(e.target.value) })}
                className="w-full rounded-md border border-ln bg-sf px-3 py-1.5 text-ui font-mono text-t1 focus:border-acc focus:outline-none transition-all pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-caption font-mono text-t3">%</span>
            </div>
          </div>
        </div>

        {/* WhatsApp Receipt Toggle */}
        <div className="p-3.5 rounded-card border border-ln bg-sf2 flex items-center justify-between gap-3">
          <div>
            <p className="text-ui font-semibold text-t1">Automated WhatsApp Payment Receipts</p>
            <p className="text-caption text-t3 mt-0.5">
              Automatically dispatch PDF receipt links to customers via WhatsApp upon recording payment.
            </p>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={s.send_receipts_to_customer}
              onChange={(e) => setS({ ...s, send_receipts_to_customer: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-sf3 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-sf after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-sf after:border-ln after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-acc"></div>
          </label>
        </div>
      </div>

      {/* Save Action */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          type="button"
          onClick={save}
          disabled={isPending}
        >
          {isPending ? "Saving Settings..." : "Save Settings"}
        </Button>
        {saved && <span className="text-caption font-semibold text-pos bg-sf2 border border-ln px-2.5 py-1 rounded-md">Saved successfully ✓</span>}
        {error && <span className="text-caption font-semibold text-warn bg-sf2 border border-ln px-2.5 py-1 rounded-md">{error}</span>}
      </div>
    </div>
  );
}
