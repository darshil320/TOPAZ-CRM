"use server";

export async function enrollCustomer(data: {
  name: string;
  phone: string;
  wa_id: string;
  primary_interest: string;
  face_tracking: boolean;
  personal_data: boolean;
  whatsapp_marketing: boolean;
}): Promise<{ success: boolean; error: string | null; customerId?: string }> {
  const apiUrl = process.env.TOPAZ_API_URL;
  const apiKey = process.env.DASHBOARD_API_KEY;

  if (!apiUrl) {
    return { success: false, error: "TOPAZ_API_URL is not configured." };
  }

  try {
    const response = await fetch(`${apiUrl}/api/enrollment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API-Key": apiKey ?? "",
      },
      body: JSON.stringify({
        name: data.name || null,
        phone: data.phone || null,
        wa_id: data.wa_id || null,
        primary_interest: data.primary_interest || null,
        face_tracking: data.face_tracking,
        personal_data: data.personal_data,
        whatsapp_marketing: data.whatsapp_marketing,
        camera_id: "kiosk",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      let message = `API error ${response.status}`;
      try {
        const json = JSON.parse(text);
        message = json.detail ?? json.error ?? message;
      } catch {
        if (text) message = text;
      }
      return { success: false, error: message };
    }

    const body = await response.json();
    return { success: true, error: null, customerId: body.customer_id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error during enrollment.";
    return { success: false, error: message };
  }
}
