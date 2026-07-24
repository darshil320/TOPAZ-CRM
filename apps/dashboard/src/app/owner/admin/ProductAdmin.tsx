"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProduct, setProductActive } from "./actions";

export interface AdminProduct {
  id: string;
  name: string;
  category: string | null;
  hsn: string;
  gst_rate: number;
  base_price: number | null;
  unit: string | null;
  active: boolean;
}

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function ProductAdmin({ products }: { products: AdminProduct[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", category: "", hsn: "9403", gst_rate: "18", base_price: "", unit: "nos" });

  const add = () => {
    setError(null);
    startTransition(async () => {
      const result = await addProduct(form);
      if (result.error) {
        setError(result.error);
        return;
      }
      setForm({ name: "", category: "", hsn: "9403", gst_rate: "18", base_price: "", unit: "nos" });
      router.refresh();
    });
  };

  const toggle = (id: string, active: boolean) => {
    startTransition(async () => {
      await setProductActive(id, active);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <input className={`${FIELD} col-span-2`} placeholder="Name" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={FIELD} placeholder="Category" value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input className={FIELD} placeholder="HSN" value={form.hsn}
          onChange={(e) => setForm({ ...form, hsn: e.target.value })} />
        <input className={FIELD} placeholder="GST%" value={form.gst_rate}
          onChange={(e) => setForm({ ...form, gst_rate: e.target.value })} />
        <input className={FIELD} placeholder="Price" value={form.base_price}
          onChange={(e) => setForm({ ...form, base_price: e.target.value })} />
      </div>
      <button type="button" onClick={add} disabled={isPending}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
        {isPending ? "Saving…" : "Add product"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {products.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-400">No products yet.</p>
        ) : (
          products.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div>
                <span className={p.active ? "font-medium text-slate-800" : "text-slate-400 line-through"}>{p.name}</span>
                <span className="ml-2 text-xs text-slate-400">HSN {p.hsn} · {p.gst_rate}%{p.base_price != null ? ` · ₹${p.base_price}` : ""}</span>
              </div>
              <button type="button" onClick={() => toggle(p.id, !p.active)} disabled={isPending}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-60">
                {p.active ? "Deactivate" : "Activate"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
