"use client";

import { useState, useTransition } from "react";
import { updateInterestSummary } from "./actions";
import Button from "@/components/ui/Button";

interface Props {
  customerId: string;
  initialSummary: string | null;
}

export default function InterestSummary({ customerId, initialSummary }: Props) {
  const [value, setValue] = useState(initialSummary ?? "");
  const [saved, setSaved] = useState(initialSummary ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirty = value.trim() !== saved.trim();

  const handleSave = () => {
    startTransition(async () => {
      const { error } = await updateInterestSummary(customerId, value);
      if (error) {
        setError(error);
      } else {
        setError(null);
        setSaved(value);
      }
    });
  };

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What is this customer looking for? Budget, style, room, timeline…"
        rows={3}
        className="w-full text-ui border border-ln rounded-card px-3 py-2 focus:outline-none focus:border-acc resize-none bg-sf2 text-t1 placeholder-t3"
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!dirty || isPending}
        >
          {isPending ? "Saving…" : dirty ? "Save" : "Saved"}
        </Button>
        {error && <span className="text-caption text-warn">{error}</span>}
      </div>
    </div>
  );
}
