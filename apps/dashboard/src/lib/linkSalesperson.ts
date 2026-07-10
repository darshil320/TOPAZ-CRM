const API_BASE = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";

/**
 * Best-effort first-login link: asks apps/api to match this auth user's phone
 * to a pre-seeded, still-unlinked `salespersons` row (§19-B). Never throws —
 * a failure here just means the caller falls back to the manual-link screen.
 */
export async function tryAutoLinkSalesperson(
  authUid: string,
  phone: string | null,
): Promise<boolean> {
  if (!phone || !DASHBOARD_API_KEY) return false;
  try {
    const resp = await fetch(`${API_BASE}/api/auth/link-salesperson`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
      headers: { "Content-Type": "application/json", "API-Key": DASHBOARD_API_KEY },
      body: JSON.stringify({ auth_uid: authUid, phone }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return Boolean(data.linked);
  } catch {
    return false;
  }
}
