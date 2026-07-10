import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import VisitAlertBanner from "@/components/VisitAlertBanner";
import AvailabilityToggle from "@/components/AvailabilityToggle";
import SignOutButton from "@/components/SignOutButton";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: salesperson } = await supabase
    .from("salespersons")
    .select("id, name, role, available")
    .eq("auth_uid", user.id)
    .eq("active", true)
    .single();

  if (!salesperson) redirect("/login");

  const initials = salesperson.name
    ? salesperson.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
    : "SP";

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      <Sidebar role="salesperson" />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
          <div className="px-4 sm:px-6 h-14 flex items-center justify-end">
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-blue-700">{initials}</span>
                </div>
                <span className="text-sm text-slate-600 font-medium">{salesperson.name}</span>
              </div>
              <div className="w-px h-4 bg-slate-200 hidden sm:block" />
              <AvailabilityToggle
                salespersonId={salesperson.id}
                initialAvailable={salesperson.available ?? false}
              />
              <SignOutButton />
            </div>
          </div>
        </header>

        <VisitAlertBanner salespersonId={salesperson.id} />

        <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
