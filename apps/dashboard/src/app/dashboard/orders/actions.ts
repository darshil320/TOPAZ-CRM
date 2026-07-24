"use server";

import { revalidatePath } from "next/cache";
import { apiHeaders } from "@/lib/apiAuth";

// Order writes route through FastAPI (§19-G); reads go direct to Supabase (RLS).
const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const ORDERS_API = `${API_BASE}/api/orders`;
const TIMEOUT_MS = 10_000;

type Result = { error: string | null; id?: string };

async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "string") return body.detail;
  } catch {
    // non-JSON
  }
  return `Request failed (${resp.status})`;
}

export async function createOrderFromQuote(quotationId: string): Promise<Result> {
  if (!DASHBOARD_API_KEY) return { error: "Orders API not configured — set DASHBOARD_API_KEY" };
  try {
    const resp = await fetch(`${ORDERS_API}/from-quote/${quotationId}`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (!resp.ok) return { error: await readError(resp) };
    const order = await resp.json();
    revalidatePath("/dashboard/orders");
    revalidatePath(`/dashboard/quotes/${quotationId}`);
    return { error: null, id: order.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function patchOrderStatus(
  orderId: string,
  nextStatus: string,
  reason?: string,
): Promise<{ error: string | null }> {
  if (!DASHBOARD_API_KEY) return { error: "Orders API not configured — set DASHBOARD_API_KEY" };
  try {
    const resp = await fetch(`${ORDERS_API}/${orderId}/status`, {
      method: "PATCH",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(true),
      body: JSON.stringify({ status: nextStatus, reason: reason ?? null }),
    });
    if (!resp.ok) return { error: await readError(resp) };
    revalidatePath("/dashboard/orders");
    revalidatePath(`/dashboard/orders/${orderId}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
