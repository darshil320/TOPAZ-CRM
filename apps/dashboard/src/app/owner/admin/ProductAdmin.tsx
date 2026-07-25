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

export default function ProductAdmin({ products }: { products: AdminProduct[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "",
    hsn: "9403",
    gst_rate: "18",
    base_price: "",
    unit: "nos",
  });

  const add = () => {
    setError(null);
    startTransition(async () => {
      const result = await addProduct(form);
      if (result.error) {
        setError(result.error);
        return;
      }
      setForm({ name: "", category: "", hsn: "9403", gst_rate: "18", base_price: "", unit: "nos" });
      setShowAddForm(false);
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
    <div className="space-y-5">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">Product Catalog</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {products.length} product{products.length !== 1 ? "s" : ""} registered in catalog
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((open) => !open)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-all active:scale-95"
        >
          <svg className={`w-4 h-4 transition-transform ${showAddForm ? "rotate-45" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {showAddForm ? "Cancel" : "Add Product"}
        </button>
      </div>

      {/* Collapsible Add Product Form Card */}
      {showAddForm && (
        <div className="bg-slate-50 border border-blue-200/80 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">New Catalog Item</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Product Name *</label>
              <input
                type="text"
                placeholder="e.g. Royal 3-Seater Sofa"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Category</label>
              <input
                type="text"
                placeholder="Sofa / Bedroom"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">HSN Code</label>
              <input
                type="text"
                placeholder="9403"
                value={form.hsn}
                onChange={(e) => setForm({ ...form, hsn: e.target.value })}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">GST Rate %</label>
              <input
                type="number"
                placeholder="18"
                value={form.gst_rate}
                onChange={(e) => setForm({ ...form, gst_rate: e.target.value })}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Base Price (₹)</label>
              <input
                type="number"
                placeholder="42000"
                value={form.base_price}
                onChange={(e) => setForm({ ...form, base_price: e.target.value })}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={add}
              disabled={isPending || !form.name.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
            >
              {isPending ? "Saving..." : "Save Product"}
            </button>
          </div>

          {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
        </div>
      )}

      {/* Catalog Table */}
      <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
        {products.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <p className="text-xs font-bold text-slate-700">No catalog products added yet</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Click &quot;Add Product&quot; to populate your quotation catalog.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200/80 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">HSN</th>
                  <th className="py-3 px-4">GST Rate</th>
                  <th className="py-3 px-4">Base Price</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      <span className={p.active ? "" : "line-through text-slate-400"}>{p.name}</span>
                    </td>
                    <td className="py-3 px-4">
                      {p.category ? (
                        <span className="bg-slate-100 text-slate-700 font-medium px-2 py-0.5 rounded-md text-[11px]">
                          {p.category}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium text-slate-600">{p.hsn}</td>
                    <td className="py-3 px-4 font-medium text-slate-700">{p.gst_rate}%</td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {p.base_price != null ? `₹${p.base_price.toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => toggle(p.id, !p.active)}
                        disabled={isPending}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${
                          p.active
                            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${p.active ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {p.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
