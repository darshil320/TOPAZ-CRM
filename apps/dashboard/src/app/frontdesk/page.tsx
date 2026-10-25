import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, UserPlus } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { isDispatcher } from "@/lib/roles";
import PageHeader from "@/components/ui/PageHeader";
import SectionHeader from "@/components/ui/SectionHeader";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import WalkinDispatchList, { type DispatchRow } from "./WalkinDispatchList";

export const dynamic = "force-dynamic";

// The newest walk-ins are the ones the desk is working; older unclaimed ones are still
// listed up to this many, newest first.
const RECENT_LIMIT = 300;

interface UnclaimedRow {
  id: string;
  name: string | null;
  phone: string | null;
  primary_interest: string | null;
  created_at: string;
}

/**
 * Front desk (0052): register a walk-in at the kiosk (with a salesperson picked there),
 * hand any unclaimed walk-in to a salesperson, and prepare quotations on a salesperson's
 * behalf. Owner-level and admin can use it too. Reads are RLS-scoped (is_dispatcher sees
 * every customer); writes go through the API.
 */
export default async function FrontDeskPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!isDispatcher(sp.role)) redirect("/dashboard");

  const supabase = await createServerSupabaseClient();
  // `unclaimed_walkins` (0052) filters "no active primary" in SQL. It is absent from the
  // generated types until they are regenerated — same widening cast the leads pages use.
  const db = supabase as unknown as { from: (table: string) => any };
  const [{ data: sellers }, { data: customers, count }] = await Promise.all([
    supabase.from("salespersons").select("id, name").eq("role", "salesperson").eq("active", true).order("name"),
    db
      .from("unclaimed_walkins")
      .select("id, name, phone, primary_interest, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT) as Promise<{ data: UnclaimedRow[] | null; count: number | null }>,
  ]);

  const sellerOptions = (sellers ?? []).map((s) => ({ id: s.id, name: s.name }));
  const waiting: DispatchRow[] = (customers ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    interest: c.primary_interest,
    createdAt: c.created_at,
  }));

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-28 sm:pb-8">
      <PageHeader
        title="Front Desk"
        subtitle="Register walk-ins, hand them to a salesperson, and prepare quotations on their behalf"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="space-y-3">
          <SectionHeader label="Register a walk-in" />
          <p className="text-caption text-t2">
            Open the kiosk while signed in here and you can pick their salesperson as you
            register them. Leave it blank and they wait in every salesperson&apos;s walk-in queue.
          </p>
          <Link href="/kiosk" className={buttonVariants({ variant: "secondary" })}>
            <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
            Open kiosk
          </Link>
        </Card>
        <Card className="space-y-3">
          <SectionHeader label="Quotation for a salesperson" />
          <p className="text-caption text-t2">
            Pick the salesperson and any customer. The quotation is theirs; you are recorded
            as the one who prepared it.
          </p>
          <Link href="/dashboard/quotes/new" className={buttonVariants({ variant: "secondary" })}>
            <FileText className="h-3.5 w-3.5" strokeWidth={2} />
            New quotation
          </Link>
        </Card>
      </div>

      <section className="space-y-3">
        <SectionHeader
          label={(count ?? 0) > waiting.length ? `Walk-ins waiting · newest ${waiting.length}` : "Walk-ins waiting"}
          total={count ?? waiting.length}
        />
        <WalkinDispatchList rows={waiting} sellers={sellerOptions} />
      </section>
    </div>
  );
}
