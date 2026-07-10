"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimCustomer } from "./actions";

export default function ClaimButton({ customerId }: { customerId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const router = useRouter();

  const handleClaim = () => {
    setError(null);
    startTransition(async () => {
      const result = await claimCustomer(customerId);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.won) {
        setClaimed(true);
      } else {
        setError("Someone else claimed this first");
      }
      router.refresh();
    });
  };

  if (claimed) {
    return <span className="text-xs font-semibold text-green-600 shrink-0">Claimed ✓</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <button
        onClick={handleClaim}
        disabled={isPending}
        className="text-xs font-medium bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-lg px-3 py-1.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isPending ? "Claiming…" : "Claim"}
      </button>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
