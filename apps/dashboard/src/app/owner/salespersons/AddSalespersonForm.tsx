"use client";

import { useState, useTransition } from "react";
import { addSalesperson, type StaffRole } from "./actions";
import { Card } from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";

// The full role enum (salespersons_role_check, migration 0011). This form only ever
// exposed salesperson/owner — workshop_manager and delivery had no way to be created
// at all, which silently blocked module 14's staff hierarchy and the transit app from
// ever getting a real login.
const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: "salesperson", label: "Salesperson" },
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "accounts", label: "Accounts" },
  { value: "workshop_manager", label: "Workshop Manager (lead/sub-manager)" },
  { value: "delivery", label: "Delivery (transit driver)" },
];

export default function AddSalespersonForm() {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [role, setRole] = useState<StaffRole>("salesperson");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
      // No router.refresh(): the action revalidates this page, so its own response
      // already carries the fresh tree. Refreshing too re-rendered the whole admin
      // page a second time per save.
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
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className="border border-ln rounded-md px-3 py-1.5 text-ui bg-sf2 text-t1 font-medium focus:outline-none focus:border-acc transition-all"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
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
