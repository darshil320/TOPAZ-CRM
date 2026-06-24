import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import VisitAlertBanner from "@/components/VisitAlertBanner";
import SignOutButton from "@/components/SignOutButton";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // salespersons.auth_uid links to supabase auth.users.id
  const { data: salesperson } = await supabase
    .from("salespersons")
    .select("id, name, role")
    .eq("auth_uid", user.id)
    .eq("active", true)
    .single();

  if (!salesperson) redirect("/login");

  return (
    <div className="flex flex-col min-h-screen w-full">
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-bold text-gray-900">Topaz CRM</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden sm:block">{salesperson.name}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <VisitAlertBanner salespersonId={salesperson.id} />

      <main className="flex-1 max-w-4xl mx-auto w-full p-4 sm:p-6">{children}</main>
    </div>
  );
}
