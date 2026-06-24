"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const VALID_STAGES = new Set(["new", "talking", "follow_up", "won", "lost"]);
const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";

export async function moveStage(
  customerId: string,
  stage: string,
): Promise<{ error: string | null }> {
  if (!VALID_STAGES.has(stage)) {
    return { error: `Invalid stage: ${stage}` };
  }
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from("pipeline_stages")
      .upsert({ customer_id: customerId, stage }, { onConflict: "customer_id" });
    if (error) return { error: error.message };
    revalidatePath(`/dashboard/customers/${customerId}`);
    return { error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return { error: message };
  }
}

export async function sendReply(
  customerId: string,
  waId: string,
  content: string,
): Promise<{ error: string | null; messageId?: string }> {
  if (!content.trim()) return { error: "Message is empty" };
  if (!DASHBOARD_API_KEY) return { error: "Send not configured — set DASHBOARD_API_KEY" };

  try {
    const supabase = await createServerSupabaseClient();

    // 1. Write the pending message row to the DB so it appears immediately in the thread.
    const { data: msg, error: insertErr } = await supabase
      .from("messages")
      .insert({
        customer_id: customerId,
        direction: "outbound",
        content,
        sender_type: "salesperson",
        status: "pending",
      })
      .select("id")
      .single();

    if (insertErr || !msg) return { error: insertErr?.message ?? "Failed to save message" };

    // 2. Enqueue the WhatsApp send via the FastAPI backend (§19-G: no service-role key in browser).
    const resp = await fetch(`${API_BASE}/api/whatsapp/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API-Key": DASHBOARD_API_KEY,
      },
      body: JSON.stringify({ wa_id: waId, content, message_id: msg.id }),
    });

    if (!resp.ok) {
      return { error: `Send failed (${resp.status})` };
    }

    revalidatePath(`/dashboard/customers/${customerId}`);
    return { error: null, messageId: msg.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return { error: message };
  }
}
