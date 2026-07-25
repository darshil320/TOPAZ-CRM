"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProduct, setProductActive } from "./actions";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import Pill from "@/components/ui/Pill";
import { Plus, X } from "lucide-react";

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
    <div className="space-y-4">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between">
        <div>
          <SectionHeader label="Product Catalog" />
          <p className="text-caption text-t3 mt-0.5">
            {products.length} product{products.length !== 1 ? "s" : ""} registered in catalog
          </p>
        </div>

        <Button
          type="button"
          onClick={() => setShowAddForm((open) => !open)}
          variant={showAddForm ? "secondary" : "primary"}
        >
          {showAddForm ? <X className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
          {showAddForm ? "Cancel" : "Add Product"}
        </Button>
      </div>

      {/* Collapsible Add Product Form Card */}
      {showAddForm && (
        <div className="bg-sf2 border border-ln rounded-card p-4 space-y-3">
          <span className="text-section font-semibold text-t1">New Catalog Item</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-caption font-semibold text-t2 mb-1">Product Name *</label>
              <input
                type="text"
                placeholder="e.g. Royal 3-Seater Sofa"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-md border border-ln bg-sf px-3 py-1.5 text-ui text-t1 placeholder-t3 focus:border-acc focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-caption font-semibold text-t2 mb-1">Category</label>
              <input
                type="text"
                placeholder="Sofa / Bedroom"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-md border border-ln bg-sf px-3 py-1.5 text-ui text-t1 placeholder-t3 focus:border-acc focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-caption font-semibold text-t2 mb-1">HSN Code</label>
              <input
                type="text"
                placeholder="9403"
                value={form.hsn}
                onChange={(e) => setForm({ ...form, hsn: e.target.value })}
                className="w-full rounded-md border border-ln bg-sf px-3 py-1.5 text-ui text-t1 font-mono placeholder-t3 focus:border-acc focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-caption font-semibold text-t2 mb-1">GST Rate %</label>
              <input
                type="number"
                placeholder="18"
                value={form.gst_rate}
                onChange={(e) => setForm({ ...form, gst_rate: e.target.value })}
                className="w-full rounded-md border border-ln bg-sf px-3 py-1.5 text-ui text-t1 font-mono placeholder-t3 focus:border-acc focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-caption font-semibold text-t2 mb-1">Base Price (₹)</label>
              <input
                type="number"
                placeholder="42000"
                value={form.base_price}
                onChange={(e) => setForm({ ...form, base_price: e.target.value })}
                className="w-full rounded-md border border-ln bg-sf px-3 py-1.5 text-ui text-t1 font-mono placeholder-t3 focus:border-acc focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={add}
              disabled={isPending || !form.name.trim()}
            >
              {isPending ? "Saving..." : "Save Product"}
            </Button>
          </div>

          {error && <p className="text-caption text-warn">{error}</p>}
        </div>
      )}

      {/* Catalog Table */}
      <div className="rounded-card border border-ln bg-sf overflow-hidden">
        {products.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-body font-semibold text-t1">No catalog products added yet</p>
            <p className="text-caption text-t3 mt-0.5">Click &quot;Add Product&quot; to populate your quotation catalog.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-ui">
              <thead>
                <tr className="bg-sf2 border-b border-ln text-caption font-semibold text-t3 uppercase tracking-wider">
                  <th className="py-2.5 px-4">Item Name</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4">HSN</th>
                  <th className="py-2.5 px-4">GST Rate</th>
                  <th className="py-2.5 px-4">Base Price</th>
                  <th className="py-2.5 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ln2">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-sf2 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-t1">
                      <span className={p.active ? "" : "line-through text-t3"}>{p.name}</span>
                    </td>
                    <td className="py-2.5 px-4">
                      {p.category ? (
                        <span className="bg-sf2 text-t2 font-medium px-2 py-0.5 rounded-kbd text-[11px] border border-ln">
                          {p.category}
                        </span>
                      ) : (
                        <span className="text-t3">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-t2">{p.hsn}</td>
                    <td className="py-2.5 px-4 font-mono text-t2">{p.gst_rate}%</td>
                    <td className="py-2.5 px-4 font-semibold font-mono text-t1">
                      {p.base_price != null ? `₹${p.base_price.toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => toggle(p.id, !p.active)}
                        disabled={isPending}
                        className="focus:outline-none"
                      >
                        <Pill tone={p.active ? "pos" : "neutral"} dot={true}>
                          {p.active ? "Active" : "Inactive"}
                        </Pill>
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
