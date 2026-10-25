import { getCurrentSalesperson } from "@/lib/auth";
import { isDispatcher } from "@/lib/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import KioskClient from "./KioskClient";

export const dynamic = "force-dynamic";

/**
 * The kiosk stays public — a customer signs themselves up with nobody logged in, and that
 * walk-in lands in every salesperson's queue exactly as before.
 *
 * When a front desk manager (or owner/admin) is signed in on this device (0052), the form
 * also offers "Assign to salesperson": they pick the salesperson as they register the
 * person, and the walk-in goes straight to that salesperson instead of the shared queue.
 * The API re-checks the role on the assign call; showing the picker here is convenience.
 */
export default async function KioskPage() {
  const sp = await getCurrentSalesperson();
  let assignOptions: { id: string; name: string }[] | null = null;
  if (sp && isDispatcher(sp.role)) {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("salespersons")
      .select("id, name")
      .eq("role", "salesperson")
      .eq("active", true)
      .order("name");
    // No staff list ⇒ no picker; the kiosk still registers into the shared queue.
    if (error) console.error("Kiosk salesperson list failed", error.message);
    else assignOptions = data ?? [];
  }
  return <KioskClient assignOptions={assignOptions} />;
}
