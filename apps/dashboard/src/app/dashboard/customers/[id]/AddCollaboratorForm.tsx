"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCollaborator } from "./actions";

interface Option {
  id: string;
  name: string;
}

export default function AddCollaboratorForm({
  customerId,
  options,
}: {
  customerId: string;
  options: Option[];
}) {
  const [selected, setSelected] = useState(options[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (options.length === 0) {
    return <p className="text-xs text-slate-400">No other active salespersons to add.</p>;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await addCollaborator(customerId, selected);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-60"
      >
        {isPending ? "Adding…" : "Add"}
      </button>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </form>
  );
}
