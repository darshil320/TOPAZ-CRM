"use client";

import { useState, useTransition } from "react";
import Button from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createLead } from "./actions";
import { LEAD_SOURCES, sourceLabel } from "./status";

const FIELD =
  "w-full rounded-input border border-ln bg-sf px-3 py-2 text-body text-t1 " +
  "placeholder:text-t3 focus:outline-none focus:ring-2 focus:ring-acc/40";
const LABEL = "block text-caption font-semibold text-t2 mb-1";

type Props = { salespersons: { id: string; label: string }[] };

const EMPTY = {
  name: "",
  phone: "",
  society: "",
  address: "",
  requirement: "",
  comments: "",
  source: "walk_in",
  source_detail: "",
  assigned_to: "",
};

export default function LeadForm({ salespersons }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = (key: keyof typeof EMPTY, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    // Mirrors the API's own floor (10 digits) so the common typo is caught without a
    // round trip. The API stays authoritative.
    const digits = form.phone.replace(/[^0-9]/g, "");
    if (digits.length < 10) {
      setError("Enter a phone number with at least 10 digits.");
      return;
    }

    startTransition(async () => {
      const result = await createLead({ ...form, assigned_to: form.assigned_to || null });
      if (result.error) {
        setError(result.error);
        return;
      }
      setForm(EMPTY);
      setSaved(true);
    });
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="lead-name">Name</label>
            <input id="lead-name" className={FIELD} value={form.name}
              placeholder="Customer name"
              onChange={(e) => update("name", e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lead-phone">
              Phone <span className="text-neg">*</span>
            </label>
            <input id="lead-phone" className={FIELD} value={form.phone} required
              inputMode="tel" placeholder="+91 94265 29230"
              onChange={(e) => update("phone", e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lead-society">Society</label>
            <input id="lead-society" className={FIELD} value={form.society}
              placeholder="e.g. Green Valley Residency"
              onChange={(e) => update("society", e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lead-address">Address</label>
            <input id="lead-address" className={FIELD} value={form.address}
              placeholder="Flat / block, area, city"
              onChange={(e) => update("address", e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lead-source">Source</label>
            <select id="lead-source" className={FIELD} value={form.source}
              onChange={(e) => update("source", e.target.value)}>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>{sourceLabel(s)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="lead-source-detail">From whom</label>
            <input id="lead-source-detail" className={FIELD} value={form.source_detail}
              placeholder="Referrer name, campaign, staff member"
              onChange={(e) => update("source_detail", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="lead-requirement">Requirement</label>
            <textarea id="lead-requirement" rows={2} className={FIELD} value={form.requirement}
              placeholder="e.g. 7-seater sofa, teak frame, budget 1.2L"
              onChange={(e) => update("requirement", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="lead-comments">Comments</label>
            <textarea id="lead-comments" rows={2} className={FIELD} value={form.comments}
              placeholder="Anything the next person picking this up should know"
              onChange={(e) => update("comments", e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="lead-assigned">Assign to</label>
            <select id="lead-assigned" className={FIELD} value={form.assigned_to}
              onChange={(e) => update("assigned_to", e.target.value)}>
              <option value="">Unassigned</option>
              {salespersons.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.label}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <p role="alert" className="text-caption text-neg">{error}</p>}
        {saved && !error && <p role="status" className="text-caption text-pos">Lead added.</p>}

        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add Lead"}
        </Button>
      </form>
    </Card>
  );
}
