"use client";

import { useState, useTransition } from "react";
import Button from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FIELD, LABEL } from "../LeadForm";
import { LEAD_SOURCES, sourceLabel } from "../status";
import { updateLead } from "../actions";

type EditableLead = {
  id: string;
  name: string | null;
  phone: string;
  society: string | null;
  address: string | null;
  requirement: string | null;
  comments: string | null;
  source: string;
  source_detail: string | null;
  assigned_to: string | null;
};

type Props = {
  lead: EditableLead;
  salespersons: { id: string; label: string }[];
};

/** null in the DB is an empty input, not the string "null". */
function formFor(lead: EditableLead) {
  return {
    name: lead.name ?? "",
    phone: lead.phone,
    society: lead.society ?? "",
    address: lead.address ?? "",
    requirement: lead.requirement ?? "",
    comments: lead.comments ?? "",
    source: lead.source,
    source_detail: lead.source_detail ?? "",
    assigned_to: lead.assigned_to ?? "",
  };
}

/**
 * Correct a captured lead. Rendered only when the viewer is the creator or the owner;
 * the API re-checks (authz.assert_can_edit_lead), so hiding this is convenience, not
 * security.
 *
 * No router.refresh() after a save: the server action calls revalidatePath for both this
 * page and the list, which already delivers a fresh tree (same reasoning as
 * owner/admin/WorkshopAdmin.tsx).
 */
export default function LeadEditForm({ lead, salespersons }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => formFor(lead));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const set = (key: keyof ReturnType<typeof formFor>) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function toggle() {
    setError(null);
    setSaved(false);
    // Reopening starts from what the server last sent, not from an abandoned edit.
    if (!open) setForm(formFor(lead));
    setOpen((prev) => !prev);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const digits = form.phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Phone needs at least 10 digits.");
      return;
    }

    start(async () => {
      const res = await updateLead(lead.id, { ...form });
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={toggle}>
            Edit details
          </Button>
          <span className="text-caption text-t3">
            {saved ? "Saved." : "You captured this lead, so you can correct it."}
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL} htmlFor="edit-name">Name</label>
            <input id="edit-name" className={FIELD} value={form.name} onChange={set("name")} />
          </div>
          <div>
            <label className={LABEL} htmlFor="edit-phone">Phone</label>
            <input
              id="edit-phone"
              className={FIELD}
              inputMode="tel"
              value={form.phone}
              onChange={set("phone")}
              required
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="edit-society">Society</label>
            <input id="edit-society" className={FIELD} value={form.society} onChange={set("society")} />
          </div>
          <div>
            <label className={LABEL} htmlFor="edit-address">Address</label>
            <input id="edit-address" className={FIELD} value={form.address} onChange={set("address")} />
          </div>
          <div>
            <label className={LABEL} htmlFor="edit-source">Source</label>
            <select id="edit-source" className={FIELD} value={form.source} onChange={set("source")}>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>{sourceLabel(s)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="edit-source-detail">Source detail</label>
            <input
              id="edit-source-detail"
              className={FIELD}
              value={form.source_detail}
              onChange={set("source_detail")}
              placeholder="Referrer, campaign, staff member"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="edit-assigned">Assigned to</label>
            <select
              id="edit-assigned"
              className={FIELD}
              value={form.assigned_to}
              onChange={set("assigned_to")}
            >
              <option value="">Unassigned</option>
              {salespersons.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="edit-requirement">Requirement</label>
            <textarea
              id="edit-requirement"
              className={FIELD}
              rows={2}
              value={form.requirement}
              onChange={set("requirement")}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="edit-comments">Comments</label>
            <textarea
              id="edit-comments"
              className={FIELD}
              rows={2}
              value={form.comments}
              onChange={set("comments")}
            />
          </div>
        </div>

        {/* Honest about a real limit: the action drops empty strings so a PATCH cannot
            blank a field that already has text. Clearing one is a follow-up. */}
        <p className="text-caption text-t3">
          Emptying a field leaves its current value. Type a correction instead.
        </p>

        {error && <p className="text-caption text-neg">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="secondary" onClick={toggle} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
