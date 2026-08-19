"use server";

import { revalidatePath } from "next/cache";
import { apiHeaders } from "@/lib/apiAuth";

// Lead writes route through FastAPI (§19-G): the status-transition guard and the
// consent record created on conversion cannot live in RLS.
const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";
const LEADS_API = `${API_BASE}/api/leads`;
const TIMEOUT_MS = 15_000;

export type LeadResult = { error: string | null; id?: string };

async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body.detail === "string") return body.detail;
  } catch {
    // non-JSON
  }
  return `Request failed (${resp.status})`;
}

function notConfigured(): LeadResult {
  return { error: "Leads API not configured — set DASHBOARD_API_KEY" };
}

export type LeadInput = {
  name?: string;
  phone: string;
  society?: string;
  address?: string;
  requirement?: string;
  comments?: string;
  source?: string;
  source_detail?: string;
  assigned_to?: string | null;
};

// Empty strings from an untouched form field are dropped rather than sent: the API
// treats "" as a supplied value and would store blanks over real data on a PATCH.
function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
}

export async function createLead(input: LeadInput): Promise<LeadResult> {
  if (!DASHBOARD_API_KEY) return notConfigured();
  try {
    const resp = await fetch(LEADS_API, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...(await apiHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify(compact({ ...input })),
    });
    if (!resp.ok) return { error: await readError(resp) };
    const lead = await resp.json();
    revalidatePath("/dashboard/leads");
    return { error: null, id: lead.id as string };
  } catch {
    return { error: "Could not reach the leads service. Check your connection and try again." };
  }
}

export async function updateLead(id: string, input: Partial<LeadInput>): Promise<LeadResult> {
  if (!DASHBOARD_API_KEY) return notConfigured();
  try {
    const resp = await fetch(`${LEADS_API}/${id}`, {
      method: "PATCH",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...(await apiHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify(compact({ ...input })),
    });
    if (!resp.ok) return { error: await readError(resp) };
    revalidatePath("/dashboard/leads");
    return { error: null, id };
  } catch {
    return { error: "Could not reach the leads service. Check your connection and try again." };
  }
}

export async function setLeadStatus(
  id: string,
  status: string,
  lostReason?: string,
): Promise<LeadResult> {
  if (!DASHBOARD_API_KEY) return notConfigured();
  try {
    const resp = await fetch(`${LEADS_API}/${id}/status`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...(await apiHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ status, lost_reason: lostReason ?? null }),
    });
    if (!resp.ok) return { error: await readError(resp) };
    revalidatePath("/dashboard/leads");
    return { error: null, id };
  } catch {
    return { error: "Could not reach the leads service. Check your connection and try again." };
  }
}

export async function convertLead(id: string): Promise<LeadResult & { customerId?: string }> {
  if (!DASHBOARD_API_KEY) return notConfigured();
  try {
    const resp = await fetch(`${LEADS_API}/${id}/convert`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: await apiHeaders(),
    });
    if (!resp.ok) return { error: await readError(resp) };
    const body = await resp.json();
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/customers");
    return { error: null, id, customerId: body.customer_id as string };
  } catch {
    return { error: "Could not reach the leads service. Check your connection and try again." };
  }
}
