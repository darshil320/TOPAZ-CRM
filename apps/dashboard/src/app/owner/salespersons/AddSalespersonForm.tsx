"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSalesperson } from "./actions";

export default function AddSalespersonForm() {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [role, setRole] = useState<"salesperson" | "owner">("salesperson");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addSalesperson(name, whatsapp, role);
      if (result.error) {
        setError(result.error);
        return;
      }
      setName("");
      setWhatsapp("");
      setRole("salesperson");
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Add salesperson</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <input
          type="tel"
          placeholder="+919XXXXXXXXX"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          required
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "salesperson" | "owner")}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="salesperson">Salesperson</option>
          <option value="owner">Owner</option>
        </select>
        <button
          type="submit"
          disabled={isPending}
          className="bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? "Adding…" : "Add"}
        </button>
      </div>
      <p className="text-[11px] text-slate-400">
        Row is created unlinked. They auto-link on first WhatsApp-number OTP login with this exact number.
      </p>
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}
    </form>
  );
}
