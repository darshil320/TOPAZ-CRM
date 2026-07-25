import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson, isOwnerRole } from "@/lib/auth";
import WhatsAppFullView from "./WhatsAppFullView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ id: string }> };

export default async function WhatsAppPage({ params }: Props) {
  const { id } = await params;

  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  const isOwner = isOwnerRole(sp);

  const supabase = await createServerSupabaseClient();
  const { data: assignment } = await supabase
    .from("customer_assignments")
    .select("id")
    .eq("customer_id", id)
    .eq("salesperson_id", sp.id)
    .eq("active", true)
    .single();

  if (!assignment && !isOwner) redirect("/dashboard");

  const [{ data: customer }, { data: messages }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).single(),
    supabase
      .from("messages")
      .select("id, content, direction, sender_type, draft_status, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  if (!customer) notFound();

  return (
    <WhatsAppFullView
      customerId={id}
      customer={customer}
      initialMessages={(messages ?? []) as {
        id: string;
        content: string;
        direction: "outbound" | "inbound";
        sender_type: string;
        draft_status: string | null;
        created_at: string;
      }[]}
    />
  );
}
