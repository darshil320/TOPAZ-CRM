import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Resolve role and redirect to the appropriate dashboard.
  const { data: sp } = await supabase
    .from("salespersons")
    .select("role")
    .single();

  if (sp?.role === "owner") redirect("/owner");
  redirect("/dashboard");
}
