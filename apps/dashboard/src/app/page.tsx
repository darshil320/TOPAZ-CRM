import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { tryAutoLinkSalesperson } from "@/lib/linkSalesperson";

export default async function RootPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  let { data: sp } = await supabase
    .from("salespersons")
    .select("role")
    .eq("auth_uid", user.id)
    .eq("active", true)
    .single();

  if (!sp) {
    const linked = await tryAutoLinkSalesperson(user.id, user.phone ?? null);
    if (linked) {
      ({ data: sp } = await supabase
        .from("salespersons")
        .select("role")
        .eq("auth_uid", user.id)
        .eq("active", true)
        .single());
    }
  }

  if (!sp) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-base font-bold text-slate-900 mb-2">Account not set up</h1>
          <p className="text-sm text-slate-500 mb-4">
            You're authenticated as <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{user.phone ?? user.email}</span> but no salesperson record exists for this account.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Run the seed SQL in Supabase Studio to link your account, then reload this page.
          </p>
          <div className="mt-5 p-3 bg-slate-50 rounded-xl text-left">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Supabase Studio → SQL Editor</p>
            <pre className="text-[10px] text-slate-700 leading-relaxed whitespace-pre-wrap break-all font-mono">
{`INSERT INTO salespersons (auth_uid, name, role, active, whatsapp)
VALUES (
  '${user.id}',
  'Darshil',
  'owner',
  true,
  '+919426529230'
);`}
            </pre>
          </div>
          <a
            href="http://127.0.0.1:54323/project/default/sql/new"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            Open SQL Editor
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    );
  }

  if (sp.role === "owner") redirect("/owner");
  redirect("/dashboard");
}
