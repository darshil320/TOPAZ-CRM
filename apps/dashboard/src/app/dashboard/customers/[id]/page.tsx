import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ConversationThread from "./ConversationThread";
import StageSelect from "./StageSelect";

type Props = { params: Promise<{ id: string }> };

const BAND_STYLE: Record<string, string> = {
  REPEAT: "bg-green-100 text-green-700",
  UNCERTAIN: "bg-orange-100 text-orange-700",
  NEW: "bg-gray-100 text-gray-600",
};

export default async function CustomerPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve salesperson record (auth_uid → salespersons.id)
  const { data: sp } = await supabase
    .from("salespersons")
    .select("id")
    .eq("auth_uid", user.id)
    .eq("active", true)
    .single();
  if (!sp) redirect("/login");

  // Confirm this salesperson has an active assignment for this customer
  const { data: assignment } = await supabase
    .from("customer_assignments")
    .select("id")
    .eq("customer_id", id)
    .eq("salesperson_id", sp.id)
    .eq("active", true)
    .single();
  if (!assignment) redirect("/dashboard");

  const [
    { data: customer },
    { data: visits },
    { data: messages },
    { data: stageRow },
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).single(),
    supabase
      .from("visits")
      .select("id, match_band, occurred_at, photo_key")
      .eq("customer_id", id)
      .order("occurred_at", { ascending: false })
      .limit(5),
    supabase
      .from("messages")
      .select("id, content, direction, sender_type, draft_status, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: true })
      .limit(30),
    supabase.from("pipeline_stages").select("stage").eq("customer_id", id).single(),
  ]);

  if (!customer) notFound();

  const currentStage = stageRow?.stage ?? "new";

  return (
    <div className="space-y-4">
      {/* Customer header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              {customer.name ?? "Unknown"}
            </h1>
            {customer.phone && (
              <p className="text-sm text-gray-500 mt-0.5">{customer.phone}</p>
            )}
            {customer.primary_interest && (
              <p className="text-xs text-gray-400 mt-1">{customer.primary_interest}</p>
            )}
          </div>
          <span
            className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
              customer.handler_mode === "ai"
                ? "bg-purple-100 text-purple-700"
                : "bg-blue-100 text-blue-700"
            }`}
          >
            {customer.handler_mode === "ai" ? "AI Agent" : "Human"}
          </span>
        </div>
      </div>

      {/* Pipeline stage */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Stage
        </p>
        <StageSelect customerId={id} currentStage={currentStage} />
      </div>

      {/* Visit history */}
      {(visits ?? []).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Recent Visits
          </p>
          <ul className="space-y-2">
            {(visits ?? []).map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between text-sm pb-2 border-b border-gray-50 last:border-0 last:pb-0"
              >
                <span className="text-gray-600">
                  {new Date(v.occurred_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      BAND_STYLE[v.match_band] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {v.match_band}
                  </span>
                  {v.photo_key && (
                    <span className="text-xs text-blue-600">Photo</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Conversation */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[560px]">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Conversation
          </p>
        </div>
        <ConversationThread customerId={id} initialMessages={messages ?? []} />
      </div>
    </div>
  );
}
