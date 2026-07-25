"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSalesperson } from "./actions";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";

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
    <Card className="space-y-3">
      <SectionHeader label="Add Salesperson" />
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="flex-1 border border-ln rounded-md px-3 py-1.5 text-ui bg-sf2 text-t1 placeholder-t3 focus:outline-none focus:border-acc focus:bg-sf transition-all"
          />
          <input
            type="tel"
            placeholder="+919XXXXXXXXX"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            required
            className="flex-1 border border-ln rounded-md px-3 py-1.5 text-ui bg-sf2 text-t1 placeholder-t3 focus:outline-none focus:border-acc focus:bg-sf transition-all"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "salesperson" | "owner")}
            className="border border-ln rounded-md px-3 py-1.5 text-ui bg-sf2 text-t1 font-medium focus:outline-none focus:border-acc transition-all"
          >
            <option value="salesperson">Salesperson</option>
            <option value="owner">Owner</option>
          </select>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Adding…" : "Add"}
          </Button>
        </div>
        <p className="text-caption text-t3">
          Row is created unlinked. They auto-link on first WhatsApp-number OTP login with this exact number.
        </p>
        {error && (
          <p className="text-caption text-warn bg-sf2 border border-ln rounded-md px-3 py-2">{error}</p>
        )}
      </form>
    </Card>
  );
}
