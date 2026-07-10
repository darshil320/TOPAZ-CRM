import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import AddSalespersonForm from "./AddSalespersonForm";
import ActiveToggle from "./ActiveToggle";

export default async function SalespersonsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sp } = await supabase
    .from("salespersons")
    .select("role")
    .eq("auth_uid", user.id)
    .eq("active", true)
    .single();
  if (sp?.role !== "owner") redirect("/dashboard");

  const { data: salespersons } = await supabase
    .from("salespersons")
    .select("id, name, whatsapp, role, active, auth_uid, created_at")
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Salespersons</h1>
        <p className="text-sm text-slate-500 mt-0.5">{(salespersons ?? []).length} total</p>
      </div>

      <AddSalespersonForm />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest border-b border-slate-100">
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">WhatsApp</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Linked</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(salespersons ?? []).map((s) => (
              <tr key={s.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3 font-medium text-slate-900">{s.name}</td>
                <td className="px-5 py-3 text-slate-600">{s.whatsapp}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    s.role === "owner" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                  }`}>
                    {s.role}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {s.auth_uid ? (
                    <span className="text-xs text-green-600 font-medium">Yes</span>
                  ) : (
                    <span className="text-xs text-slate-400">Awaiting first login</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <ActiveToggle salespersonId={s.id} initialActive={s.active} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
