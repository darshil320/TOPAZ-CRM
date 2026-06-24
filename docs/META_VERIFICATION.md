# Topaz CRM — Meta WhatsApp Cloud API: Verification & Setup (START DAY 0)

> **This is the long pole.** Meta Business Verification can take **1–3 weeks** and is rejected for document mismatches. **Start it before any code is written.** Everything here uses the **Meta Cloud API directly** (no BSP); the prototype's AiSensy/Twilio adapter is the fallback if Meta's queue stalls go-live (see bottom).

---

## 0. What we need from Topaz (Hemant) — give him this list today

1. **Meta Business Manager access.** If Topaz has a Facebook/Instagram business presence, add Darshil (`darshil@devxlabs.ai`) as **Admin** on their Business Manager. If they don't have one, we create it in Topaz's name.
2. **Business registration document(s)** showing the legal name + address — any of: **GST registration certificate**, Shop & Establishment license, Udyam/MSME certificate, incorporation certificate. ⚠ The **name + address must match exactly** across documents — mismatch is the #1 rejection cause.
3. **A dedicated phone number** for the WhatsApp Business line — one **not already registered on WhatsApp** (personal or Business app). It must be able to receive an **OTP by SMS or voice call**. A new SIM or a landline both work. *(If the number is already on WhatsApp, it must be deleted from WhatsApp first.)*
4. **Exact legal business name + address** as printed on the GST/registration document.
5. **Business website + a business email** on that domain, if available (strengthens verification).

---

## 1. Accounts (Day 0)
- [ ] Confirm/create **Topaz Business Manager** (business.facebook.com), owned by Topaz, Darshil as admin. Note the **Business Manager ID**.
- [ ] **Darshil's Meta Developer account** (developers.facebook.com).

## 2. Start Business Verification — DO THIS FIRST (this is the clock)
- [ ] Business Settings → **Security Center** → Start Business Verification.
- [ ] Upload registration docs; enter legal name + address **exactly** as on the docs.
- [ ] Provide business phone + website. Submit.
- [ ] ⏳ It now sits in Meta's review queue (days–weeks). **Everything below proceeds in parallel.**

## 3. Create the App + WhatsApp product
- [ ] Developer dashboard → **Create App** → type **Business**.
- [ ] Add the **WhatsApp** product; link it to Topaz's Business Manager.
- [ ] Note the **WABA ID** and **App ID / App Secret**.

## 4. Register the phone number
- [ ] WhatsApp → API Setup → add the **dedicated number** → receive + enter OTP.
- [ ] Set the **display name** ("Topaz Furniture") — must relate to the business; it is reviewed.
- [ ] Note the **Phone Number ID**.
- [ ] Business Settings → System Users → create a **System User**, assign the App + WABA, generate a **long-lived access token** with `whatsapp_business_messaging` + `whatsapp_business_management`. ⚠ Store as a secret (never in source) — this is `META_WHATSAPP_TOKEN`.

## 5. Webhook (after the backend is reachable — not a Day-0 blocker)
- [ ] Webhook URL `https://<api-domain>/api/whatsapp/webhook` + a **32-byte random verify token** (plan §19-G).
- [ ] Subscribe to fields: `messages`, `message_template_status_update`, and message status.
- [ ] HMAC-SHA256 verification using the **App Secret** (plan §8).

## 6. Templates (parallel; approval = minutes–48h, separate from business verification)
- [ ] Submit the templates from plan §5.3 (arrival alert, thank-you, follow-up nudge, quote-ready) + one re-engagement template.
- [ ] **Category matters for cost & rules:** UTILITY (transaction-tied, free/cheap in-window) vs MARKETING (needs opt-in, frequency-capped). Keep marketing nudges ≤1 per 24h window (plan §19-F).

## 7. Messaging limits (set expectations)
A new number starts at a **low tier** (~250–1,000 business-initiated conversations / 24h) and scales up as verification completes and quality rating stays high. Fine for one showroom at launch.

---

## Fallback — if Meta verification stalls past the deadline
The prototype already has a **BSP adapter (AiSensy / Twilio)** behind the `WhatsAppAdapter` interface. BSPs handle verification themselves, so they can go live faster — at higher per-message cost and less control. Keep it ready as the unblock path; swap back to the Cloud API once Meta verifies. This is why ADR-16's adapter abstraction matters.

*TOPAZ-META-SETUP · DMC Digital · 24 June 2026 · companion to EXECUTION_PLAN.md v2.3 §8 + §19-F/G*
