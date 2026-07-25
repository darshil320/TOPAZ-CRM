import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import AddSalespersonForm from "./AddSalespersonForm";
import ActiveToggle from "./ActiveToggle";

export default async function SalespersonsPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!isOwnerRole(sp)) redirect("/dashboard");

  const supabase = await createServerSupabaseClient();
  const { data: salespersons } = await supabase
    .from("salespersons")
    .select("id, name, whatsapp, role, active, auth_uid, created_at")
    .order("created_at", { ascending: true });

  const total = (salespersons ?? []).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Salespersons"
        subtitle={`${total} total`}
      />

      <AddSalespersonForm />

      <Card className="p-0 overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[560px] text-ui whitespace-nowrap">
          <thead>
            <tr className="text-left text-caption font-semibold text-t3 uppercase tracking-wider border-b border-ln bg-sf2">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">WhatsApp</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Linked</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ln2">
            {(salespersons ?? []).map((s) => (
              <tr key={s.id} className="hover:bg-sf2 transition-colors">
                <td className="px-4 py-3 font-semibold text-t1">{s.name}</td>
                <td className="px-4 py-3 text-t2 font-mono">{s.whatsapp}</td>
                <td className="px-4 py-3">
                  <Pill tone={s.role === "owner" ? "warn" : "neutral"} dot={false}>
                    {s.role}
                  </Pill>
                </td>
                <td className="px-4 py-3">
                  {s.auth_uid ? (
                    <span className="text-caption text-pos font-medium">Yes</span>
                  ) : (
                    <span className="text-caption text-t3">Awaiting first login</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <ActiveToggle salespersonId={s.id} initialActive={s.active} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
