# UAT 2A — Production Smoke Checklist

Tick through these on the **live** stack (Railway API + Vercel dashboard + prod Supabase)
to prove 2A modules 03–07 end-to-end before starting 2B. Module 03 (quote send) already
PASSED on 2026-07-26; the rest below are unproven on prod.

> **Legend:** ☐ not run · ✅ pass · ❌ fail (log the wamid / error / row id in-line).

---

## 0. Preconditions (do once)

- ☐ **Apply migration 0021** to prod (adds `messages` to `supabase_realtime`) — run
  `supabase/migrations/0021_messages_realtime.sql` (or the tail of
  `supabase/phase2_prod_migrations.sql`) in the Supabase SQL editor. Without it the
  conversation thread updates only on manual reload.
- ☐ Confirm Vercel is serving commit `9b786d5` or later (live thread + newest-30 fix).
- ☐ Confirm Railway is serving commit `0a43348` or later (PDF `asyncio.to_thread` fix).
- ☐ **Second test phone** with WhatsApp, number ≠ 919426529230. Create its customer row
  (no dashboard UI — SQL, `wa_id` = digits, no `+`):
  ```sql
  insert into consents (personal_data, whatsapp_marketing, method)
  values (true, true, 'web_form') returning id;   -- copy id
  insert into customers (consent_id, name, phone, wa_id, ai_autosend)
  values ('<consent-id>', 'UAT Subject', '<digits>', '<digits-no-plus>', false)
  returning id;
  ```

---

## 1. Live conversation thread (fix verification)

- ☐ Open **My Customers → the test customer** (conversation panel, not the Quotations page).
- ☐ From the test phone, send a WhatsApp to the business number.
- ☐ Message appears in the thread **without reloading** (proves 0021 applied + realtime on).
- ☐ Send a reply from the dashboard composer → appears in the thread + arrives on the phone.
- ☐ The earlier quote message is visible in the thread (newest-30, chronological order).

## 2. Quote — out-of-window template path (blocked on Meta approval)

> Only runnable once `quote_sent` / `quote_approved_confirm` are **Active** at Meta.
> Until then the in-window text path (module 03) is the proven route.

- ☐ Pick a customer whose window is **closed** (no inbound in >24h).
- ☐ New Quote → Send.
- ☐ Worker log shows `template=quote_sent` and a non-null `wamid` (not `132xxx`).
- ☐ Template message with the approval link arrives on the phone.

## 3. Approve / reject on the public page

- ☐ Open the `/q/<token>` link from a sent quote (incognito — token is the only auth).
- ☐ **Approve** → page confirms; quote flips to `approved`.
- ☐ Customer confirmation message arrives (text if window open, else `quote_approved_confirm`).
- ☐ Assigned salesperson (or owner fallback) gets the "APPROVED ✅" alert with the dashboard link.
- ☐ Repeat on a second quote with **Reject** → "requested changes" alert fires.

## 4. Order from an approved quote

- ☐ On the approved quote → **Create order**.
- ☐ Order totals + line items copy the quote **verbatim**; advance = configured
  `default_advance_pct` (50%).
- ☐ Order detail shows outstanding = grand total − advance, schedule rows, empty timeline.
- ☐ Advance the status once (OrderStatusActions) → timeline records the transition + reason.

## 5. Payment + receipt PDF ⚠️ (same render path as the 03 crash)

- ☐ On the order → **Record payment** (amount ≤ outstanding).
- ☐ Payment row created; outstanding drops; earliest schedule flips to paid.
- ☐ **Receipt PDF renders** — check Railway worker log for `Rendered … receipts/RCP-…pdf`
  (this is `tasks/receipts._render`, which had the identical sync-Playwright bug now fixed).
- ☐ If `send_receipts_to_customer = true`: receipt/text arrives on the phone.
- ☐ Try an **over-payment** → 409 unless an elevated user overrides (TOCTOU guard).
- ☐ Try a **refund** as a salesperson → 403 (accounts/owner/admin only).

## 6. Payment reminder — `payment_due` (Active now, runnable)

- ☐ Give the test order a schedule row **due today/overdue**.
- ☐ Run `tasks/payment_reminders` (daily 10:00 IST, or trigger manually).
- ☐ `payment_due` template arrives on the phone (utility → bypasses marketing consent).

## 7. Roles / RLS live

- ☐ Log in as a **salesperson** (phone OTP, not owner). See only their assigned customers;
  another sp's customer 404/redirects.
- ☐ Salesperson **cannot** record a payment (403); **accounts** can; owner sees everything.
- ☐ Confirm accounts lands on `/dashboard/payments`; owner reaches `/owner/admin`.

---

## Go-live blockers (separate from UAT — must clear before real customers)

- ☐ 🔴 Rotate `WA_TOKEN` (Meta System User token) — transcript-exposed.
- ☐ 🔴 Rotate prod DB password (shared prod+UAT) — transcript-exposed.
- ☐ 🔴 Revoke the leaked Supabase session (refresh token) for 919426529230.
- ☐ 🟡 Meta approval of `quote_sent` + `quote_approved_confirm` (In review).
- ☐ 🟡 LOW rate-limiting on public + dashboard-key routes.
- ☐ 🟡 Go-live re-review of the JWT auth change + `api/auth.py:link_salesperson` body-trust.

## Sign-off

- 2A verified end-to-end on prod: ______ (date / who)
- Cleared to start 2B (modules 08–13, **separate SOW scope** — paper the CR first): ☐
