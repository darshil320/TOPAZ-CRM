import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { tryAutoLinkSalesperson } from "@/lib/linkSalesperson";

export default async function RootPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const supabase = await createServerSupabaseClient();

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
            Ask your owner/admin to add you under <span className="font-semibold text-slate-600">Owner → Salespersons</span> — the WhatsApp number there must match{" "}
            <span className="font-mono text-slate-600">{user.phone ?? user.email}</span> exactly. Reload this page once that's done; linking is automatic.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed mt-2">
            Already added? Right after a brand-new phone's first-ever login, the
            number can take one extra reload to fully register — try the button below
            before assuming anything is wrong.
          </p>
          <a
            href="/"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Try again
          </a>
          <details className="mt-5 text-left">
            <summary className="cursor-pointer text-[11px] font-semibold text-slate-400 hover:text-slate-500">
              Owner bootstrapping the very first account?
            </summary>
            <div className="mt-2 p-3 bg-slate-50 rounded-xl">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Supabase Dashboard → SQL Editor for THIS project
              </p>
              <pre className="text-[10px] text-slate-700 leading-relaxed whitespace-pre-wrap break-all font-mono">
{`INSERT INTO salespersons (auth_uid, name, role, active, whatsapp)
VALUES (
  '${user.id}',
  '<your name>',
  'owner',  -- or 'admin' / 'salesperson' / 'workshop_manager' / 'accounts' / 'delivery'
  true,
  '${user.phone ? (user.phone.startsWith("+") ? user.phone : `+${user.phone}`) : "<this account's WhatsApp number, E.164>"}'
);`}
              </pre>
              <p className="mt-2 text-[10px] text-slate-400 leading-relaxed">
                Only use this for the FIRST account (nobody exists yet to use the
                Salespersons screen). Every account after that should go through
                Owner → Salespersons, not raw SQL.
              </p>
            </div>
          </details>
        </div>
      </div>
    );
  }

  if (sp.role === "owner") redirect("/owner");
  redirect("/dashboard");
}
