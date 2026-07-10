import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import VisitAlertBanner from "@/components/VisitAlertBanner";
import SignOutButton from "@/components/SignOutButton";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: salesperson } = await supabase
    .from("salespersons")
    .select("id, name, role")
    .eq("auth_uid", user.id)
    .eq("active", true)
    .single();

  if (!salesperson) redirect("/login");

  const initials = salesperson.name
    ? salesperson.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
    : "SP";

  return (
    <div className="flex flex-col min-h-screen w-full bg-slate-50">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <span className="font-semibold text-slate-900 text-sm tracking-tight">Topaz CRM</span>
            <span className="hidden sm:inline text-xs text-slate-400 font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Owner</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center">
                <span className="text-[10px] font-bold text-amber-700">{initials}</span>
              </div>
              <span className="text-sm text-slate-600 font-medium">{salesperson.name}</span>
            </div>
            <div className="w-px h-4 bg-slate-200 hidden sm:block" />
            <SignOutButton />
          </div>
        </div>
      </header>

      <VisitAlertBanner salespersonId={salesperson.id} />

      <nav className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-4 flex items-center gap-4">
        <Link href="/owner" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
          Pipeline
        </Link>
        <Link href="/owner/salespersons" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
          Salespersons
        </Link>
      </nav>

      <main className="flex-1 max-w-6xl mx-auto w-full p-4 sm:p-6">{children}</main>
    </div>
  );
}
