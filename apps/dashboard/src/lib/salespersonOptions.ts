/**
 * Staff options for the "filter by salesperson" control on the list pages.
 *
 * RLS decides the contents, not this module: `sp_select_self_or_owner` (0005)
 * lets an owner read the whole roster and everyone else read only their own
 * row. A single-option list therefore means "this user has nobody to filter
 * between" and the caller hides the control — see `ListFilterBar`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";

export type SalespersonOption = {
  id: string;
  /** Display label, already suffixed for staff who have left. */
  label: string;
};

export async function listSalespersonOptions(
  supabase: SupabaseClient<Database>,
): Promise<SalespersonOption[]> {
  const { data, error } = await supabase
    .from("salespersons")
    .select("id, name, active")
    .order("name", { ascending: true });

  if (error) {
    console.error("salesperson options lookup failed", error);
    return [];
  }

  return (data ?? []).map((sp) => ({
    id: sp.id,
    label: sp.active ? sp.name : `${sp.name} (inactive)`,
  }));
}
