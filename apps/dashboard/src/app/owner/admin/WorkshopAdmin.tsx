"use client";

/**
 * Workshops admin tab — the ONLY intake path for production sites.
 *
 * The `workshops` table ships empty on purpose (migration 0023): a placeholder
 * workshop can receive a real allocation and drive an order to 'ready' against a
 * site that does not exist. So this tab is the mechanism, and every failure message
 * from the API is shown verbatim rather than paraphrased.
 *
 * There is no delete — workshops are deactivated, and the API refuses to deactivate
 * one that still holds unfinished items.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Pencil, PowerOff } from "lucide-react";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import Pill from "@/components/ui/Pill";

export interface AdminWorkshop {
  id: string;
  name: string;
  type: string;
  manager_name: string | null;
  manager_phone: string | null;
  manager_salesperson_id: string | null;
  address: string | null;
  active: boolean;
  open_item_count: number;
}

export interface ManagerOption {
  id: string;
  name: string | null;
  role: string | null;
}

export interface WorkshopFormValues {
  name: string;
  type: string;
  manager_name: string;
  manager_phone: string;
  manager_salesperson_id: string;
  address: string;
}

const EMPTY_FORM: WorkshopFormValues = {
  name: "",
  type: "own",
  manager_name: "",
  manager_phone: "",
  manager_salesperson_id: "",
  address: "",
};

const FIELD =
  "w-full rounded-md border border-ln bg-sf px-3 py-1.5 text-ui text-t1 placeholder-t3 focus:border-acc focus:outline-none";

function formFor(w: AdminWorkshop): WorkshopFormValues {
  return {
    name: w.name,
    type: w.type,
    manager_name: w.manager_name ?? "",
    manager_phone: w.manager_phone ?? "",
    manager_salesperson_id: w.manager_salesperson_id ?? "",
    address: w.address ?? "",
  };
}

function WorkshopFields({
  values,
  onChange,
  managers,
  idPrefix,
}: {
  values: WorkshopFormValues;
  onChange: (next: WorkshopFormValues) => void;
  managers: ManagerOption[];
  idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <label htmlFor={`${idPrefix}-name`} className="mb-1 block text-caption font-semibold text-t2">
          Workshop Name *
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          placeholder="e.g. Topaz Main Floor"
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-type`} className="mb-1 block text-caption font-semibold text-t2">
          Type
        </label>
        <select
          id={`${idPrefix}-type`}
          value={values.type}
          onChange={(e) => onChange({ ...values, type: e.target.value })}
          className={FIELD}
        >
          <option value="own">Own floor</option>
          <option value="vendor">Vendor</option>
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-manager`} className="mb-1 block text-caption font-semibold text-t2">
          Manager Name
        </label>
        <input
          id={`${idPrefix}-manager`}
          type="text"
          placeholder="e.g. Suresh"
          value={values.manager_name}
          onChange={(e) => onChange({ ...values, manager_name: e.target.value })}
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-phone`} className="mb-1 block text-caption font-semibold text-t2">
          Manager Phone (E.164)
        </label>
        <input
          id={`${idPrefix}-phone`}
          type="tel"
          inputMode="tel"
          placeholder="+919876543210"
          value={values.manager_phone}
          onChange={(e) => onChange({ ...values, manager_phone: e.target.value })}
          className={`${FIELD} font-mono`}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-staff`} className="mb-1 block text-caption font-semibold text-t2">
          Linked Staff Login
        </label>
        <select
          id={`${idPrefix}-staff`}
          value={values.manager_salesperson_id}
          onChange={(e) => onChange({ ...values, manager_salesperson_id: e.target.value })}
          className={FIELD}
        >
          <option value="">Not linked</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? "Unnamed"}
              {m.role ? ` · ${m.role}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-address`} className="mb-1 block text-caption font-semibold text-t2">
          Address
        </label>
        <input
          id={`${idPrefix}-address`}
          type="text"
          placeholder="Katargam, Surat"
          value={values.address}
          onChange={(e) => onChange({ ...values, address: e.target.value })}
          className={FIELD}
        />
      </div>
    </div>
  );
}

export default function WorkshopAdmin({
  workshops,
  managers,
  loadError,
  onAdd,
  onUpdate,
  onDeactivate,
}: {
  workshops: AdminWorkshop[];
  managers: ManagerOption[];
  loadError: string | null;
  onAdd: (values: WorkshopFormValues) => Promise<{ error: string | null }>;
  onUpdate: (id: string, values: WorkshopFormValues) => Promise<{ error: string | null }>;
  onDeactivate: (id: string) => Promise<{ error: string | null }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<WorkshopFormValues>(EMPTY_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<WorkshopFormValues>(EMPTY_FORM);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const activeCount = workshops.filter((w) => w.active).length;

  function add() {
    setAddError(null);
    startTransition(async () => {
      const result = await onAdd(addForm);
      if (result.error) {
        setAddError(result.error);
        return;
      }
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
      router.refresh();
    });
  }

  function beginEdit(w: AdminWorkshop) {
    setRowError(null);
    setEditingId(w.id);
    setEditForm(formFor(w));
  }

  function saveEdit(id: string) {
    setRowError(null);
    startTransition(async () => {
      const result = await onUpdate(id, editForm);
      if (result.error) {
        setRowError({ id, message: result.error });
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function deactivate(id: string) {
    setRowError(null);
    startTransition(async () => {
      const result = await onDeactivate(id);
      if (result.error) {
        // 409: "Workshop has N item(s) still in production — reallocate them first"
        setRowError({ id, message: result.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4" id="workshops">
      <div className="flex items-center justify-between gap-3">
        <div>
          <SectionHeader label="Workshops" />
          <p className="mt-0.5 text-caption text-t3">
            {workshops.length} registered · {activeCount} active production site
            {activeCount === 1 ? "" : "s"}
          </p>
        </div>

        <Button
          type="button"
          onClick={() => {
            setShowAddForm((open) => !open);
            setAddError(null);
          }}
          variant={showAddForm ? "secondary" : "primary"}
          disabled={loadError !== null}
        >
          {showAddForm ? <X className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
          {showAddForm ? "Cancel" : "Add Workshop"}
        </Button>
      </div>

      {loadError && (
        <p className="rounded-md border border-warn/20 bg-warnS px-3 py-2 text-caption font-semibold text-warn">
          {loadError}
        </p>
      )}

      {showAddForm && (
        <div className="space-y-3 rounded-card border border-ln bg-sf2 p-4">
          <span className="text-section font-semibold text-t1">New Workshop</span>
          <WorkshopFields
            values={addForm}
            onChange={setAddForm}
            managers={managers}
            idPrefix="new-workshop"
          />
          <p className="text-[11px] text-t3">
            Leave the staff login unlinked for a vendor with no app account — its items are still
            fully allocatable and are advanced by an internal admin.
          </p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={add} disabled={isPending || !addForm.name.trim()}>
              {isPending ? "Saving…" : "Save Workshop"}
            </Button>
          </div>
          {addError && <p className="text-caption text-warn">{addError}</p>}
        </div>
      )}

      <div className="overflow-hidden rounded-card border border-ln bg-sf">
        {workshops.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-body font-semibold text-t1">No workshops registered yet</p>
            <p className="mt-0.5 text-caption text-t3">
              Production cannot be allocated until at least one workshop exists. Add the client&apos;s
              own floor and each vendor.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-ui">
              <thead>
                <tr className="border-b border-ln bg-sf2 text-caption font-semibold uppercase tracking-wider text-t3">
                  <th className="px-4 py-2.5">Workshop</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Manager</th>
                  <th className="px-4 py-2.5">Phone</th>
                  <th className="px-4 py-2.5 text-right">Open Items</th>
                  <th className="px-4 py-2.5 text-right">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ln2">
                {workshops.map((w) => (
                  <>
                    <tr key={w.id} className="transition-colors hover:bg-sf2">
                      <td className="px-4 py-2.5 font-semibold text-t1">
                        <span className={w.active ? "" : "text-t3 line-through"}>{w.name}</span>
                        {w.address && (
                          <span className="mt-0.5 block text-[11px] font-normal text-t3">
                            {w.address}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Pill tone={w.type === "own" ? "pos" : "neutral"} dot={false}>
                          {w.type === "own" ? "Own floor" : "Vendor"}
                        </Pill>
                      </td>
                      <td className="px-4 py-2.5 text-t2">
                        {w.manager_name || <span className="text-t3">—</span>}
                        {w.manager_salesperson_id && (
                          <span className="mt-0.5 block text-[11px] text-t3">has app login</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-t2">
                        {w.manager_phone || <span className="font-sans text-t3">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-t1">
                        {w.open_item_count}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Pill tone={w.active ? "pos" : "neutral"} dot={true}>
                          {w.active ? "Active" : "Inactive"}
                        </Pill>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => (editingId === w.id ? setEditingId(null) : beginEdit(w))}
                            disabled={isPending}
                          >
                            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                            <span>{editingId === w.id ? "Close" : "Edit"}</span>
                          </Button>
                          {w.active && (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => deactivate(w.id)}
                              disabled={isPending}
                            >
                              <PowerOff className="h-3.5 w-3.5" strokeWidth={2} />
                              <span>Deactivate</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {rowError?.id === w.id && (
                      <tr key={`${w.id}-error`}>
                        <td colSpan={7} className="px-4 pb-3">
                          <p className="rounded-md border border-warn/20 bg-warnS px-3 py-2 text-caption font-semibold text-warn">
                            {rowError.message}
                          </p>
                        </td>
                      </tr>
                    )}

                    {editingId === w.id && (
                      <tr key={`${w.id}-edit`} className="bg-sf2">
                        <td colSpan={7} className="px-4 py-3.5">
                          <WorkshopFields
                            values={editForm}
                            onChange={setEditForm}
                            managers={managers}
                            idPrefix={`edit-${w.id}`}
                          />
                          <div className="flex items-center justify-end gap-2 pt-3">
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setEditingId(null)}
                              disabled={isPending}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              onClick={() => saveEdit(w.id)}
                              disabled={isPending || !editForm.name.trim()}
                            >
                              {isPending ? "Saving…" : "Save changes"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
