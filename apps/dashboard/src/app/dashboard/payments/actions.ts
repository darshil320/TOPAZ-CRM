"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const TIMEOUT_MS = 10_000;

export interface PaymentInput {
  orderId: string;
  kind: string; // advance | stage | final | refund
  amount: string;
  mode: string; // cash | upi | bank | cheque | card
  paidAt: string; // yyyy-mm-dd
  reference?: string;
  notes?: string;
  overrideOverpay?: boolean;
}

async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "string") return body.detail;
  } catch {
    // non-JSON
  }
  return `Request failed (${resp.status})`;
}

export async function recordPayment(
  input: PaymentInput,
): Promise<{ error: string | null; receiptNo?: string }> {
  if (!DASHBOARD_API_KEY) return { error: "Payments API not configured — set DASHBOARD_API_KEY" };
  if (!(Number(input.amount) > 0)) return { error: "Amount must be greater than 0" };
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    const { data: sp } = await supabase
      .from("salespersons")
      .select("id")
      .eq("auth_uid", user.id)
      .eq("active", true)
      .single();
    if (!sp) return { error: "No active salesperson record" };

    // paid_at as an ISO datetime (midday local to avoid TZ date-flips).
    const paidAtIso = new Date(`${input.paidAt}T12:00:00`).toISOString();

    const resp = await fetch(`${API_BASE}/api/payments`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "API-Key": DASHBOARD_API_KEY },
      body: JSON.stringify({
        order_id: input.orderId,
        kind: input.kind,
        amount: input.amount,
        mode: input.mode,
        paid_at: paidAtIso,
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        recorded_by: sp.id,
        override_overpay: Boolean(input.overrideOverpay),
      }),
    });
    if (!resp.ok) return { error: await readError(resp) };

    const body = await resp.json();
    revalidatePath(`/dashboard/orders/${input.orderId}`);
    revalidatePath("/dashboard/payments");
    return { error: null, receiptNo: body.receipt_no as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
