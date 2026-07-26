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

## Where we are — updated 2026-07-25 (live prod status)

**Big picture:** prod DB + app are on the full 2A build; the money path is wired
and mostly proven live. What's left is (a) finish testing the payment leg, (b)
clear the security-rotation blockers, (c) get Meta template approvals, (d) staff
sign-off. Then real customers.

### ✅ Done & live on prod this session

- DB: prod **and** UAT at migration **0022**, history synced (0010–0022).
- **Auth fixed** — API now verifies Supabase **ES256** tokens via JWKS; dashboard
  writes work (was 401 "Invalid or expired session" on every write).
- **Vercel build fixed** — removed conflicting root `vercel.json`; dashboard deploys.
- **WhatsApp media enabled** — `WA_MEDIA_ENABLED=true`, Chromium/PDF engine live in
  the image, **K1 media spike passed** (PDF received on phone).
- **Live conversation thread** — `messages` added to realtime (0021) + newest-30
  fix; thread streams without reload.
- **Order-from-quote deduped** — idempotent create + unique index (0022); the
  duplicate `ORD-2627-0002` was removed; `ORD-2627-0001` is the surviving order.
- **Dashboard UI overhaul (parallel sessions, live)** — new app shell + design
  tokens, dark mode, real-time WhatsApp chat panel, `RecordPaymentForm` now a
  modal, customer detail shows orders + production status, owner/walk-in access.
  (commits `9178b4e`…`00af054`; all on `main`, deployed.)

### 📱 WhatsApp messaging model (operational — read before contacting prospects)

- WhatsApp allows **free-form** text/media only inside an **open 24-hour window**
  (opened when the customer messages the business). Outside it, ONLY an
  **approved template** may be sent. The dashboard composer sends free-form
  (`send_wa_text`) — so typing "hi" to a cold prospect **fails** until a window
  is open. This is Meta's rule, not a bug.
- **Cold prospects ARE reached automatically:** kiosk enrollment with a `wa_id`
  + WhatsApp-marketing consent schedules the approved **`topaz_welcome`** template
  (`welcome_visit` → maps to it), sent after `WELCOME_FOLLOWUP_DELAY_MINUTES`
  (**default 120 min**). When the prospect replies, the 24h window opens and the
  composer works. Verified live: prospect *sanjay bhai* got the welcome template,
  replied "Hii", and free-form messages then delivered.
- **Gap:** there is no manual "send template / start conversation" button in the
  chat UI — a salesperson cannot proactively template a cold prospect on demand
  (only the 2h auto-welcome or the quote-send template path do it). Candidate
  enhancement if reps need to reach prospects faster than the 2h delay.

### ✅ Money path proven live (real data on prod)

- Quote build + save → `QTN-2627-0004` **approved**.
- Public approve page → quote went to **approved**.
- Order from approved quote → **`ORD-2627-0001`** (confirmed, advance = 50%).

### ⏳ Left to verify on prod (UAT smoke — §5–§7 above)

- **§5 Payment + receipt PDF** — ✅ **render VERIFIED on prod**: `ORD-2627-0001`
  fully paid (3 receipts), receipt PDFs rendered ~41KB each in the `documents`
  bucket + rows recorded. Added a **"Receipt" download button** (signed-URL via new
  `GET /api/payments/{id}/receipt-url`) so staff/customers can open them. Remaining:
  eyeball the **guards** (over-payment → 409, refund as salesperson → 403).
- **§6 `payment_due` reminder** — template Active; runnable.
- **§7 Roles/RLS** — accounts records payment / salesperson blocked 403 / owner refund.
- **§2 out-of-window template send** — blocked on Meta approval below.

### 🔴 Go-live blockers (before ANY real customer) — see list above

- Rotate **`WA_TOKEN`**, **prod DB password**, and **revoke the leaked 919426529230
  session** — all transcript-exposed, still open. Highest priority.
- Meta approval of **`quote_sent`** + **`quote_approved_confirm`** (In review).

### 👉 What's next (in order)

1. **Rotate the 3 secrets** (WA_TOKEN, DB password, leaked session) — security, do first.
2. **Test the payment + receipt-PDF leg** on prod (§5) — closes the money path.
3. **Chase Meta template approvals** (unblocks out-of-window customer sends).
4. **Staff UAT sign-off** (§ sign-off) → then cleared for real customers.

## Sign-off

- 2A verified end-to-end on prod: ______ (date / who)
- Cleared to start 2B (modules 08–13, **separate SOW scope** — paper the CR first): ☐
