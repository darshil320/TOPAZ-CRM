# Topaz CRM Phase 1 — Production Deployment Map

Single source of truth for going live. Work one track at a time, in order.
Legend: **YOU** = only Darshil can do (portals, hardware, people) · **AI** = paste the prompt from §Prompts into Claude Code · **PAIR** = you drive, AI guides live.

## Status snapshot (2026-07-07)

DONE: all Phase 1 code built + empirically verified · repo on GitHub (darshil320/TOPAZ-CRM) · Railway project `cooperative-wisdom`: api + worker + beat + Redis all Online · api public domain `api-production-c6189.up.railway.app` · Meta webhook configured + verified (GET challenge green) · WhatsApp number +91 63563 20206 REGISTERED on WABA **1506116721198796**, live phone ID **1189429440922862** (both verified against Meta Graph API 2026-07-10; old phone ID 1261681507021925 and old WABA 27846807084905593 are dead/empty). Templates on live WABA: `topaz_welcome` APPROVED, lang `en`, **NAMED params** `{{customer_name}}`/`{{advisor_name}}` + URL button; `topaz_followup` **NOT YET CREATED** (send fails until created — spec: NAMED param `{{customer_name}}`, MARKETING, lang `en`) · payment method step showed green.

REMAINING: Tracks A–G below.

> **Phase 2 / 2B status lives in [`docs/phase2/STATE.md`](phase2/STATE.md), not here.** This
> file covers the Phase-1 go-live tracks only. Current cross-phase deployment facts worth
> having in one place (2026-07-27): the repo's migration head is **`0033`** while prod and
> UAT are still at **`0020`**, so migrations `0021`–`0033` (quotes/orders/payments RLS,
> workshops, production, media, job cards, module 14's workshop staff + routing +
> transit, and `0033`'s deliveries write path) all need pushing before any Phase-2B
> feature works against a real database.
> Module 14 also adds two unsubmitted Meta templates (`transfer_assigned`, `leg_overdue`).
>
> **`0033` is a live-bug fix, not a new feature:** on any database already at `0031`,
> scheduling a delivery fails with *"new row violates row-level security policy for
> table deliveries"* and the driver PWA's "mark delivered" silently no-ops. `0031`
> removed 0026's write policies expecting a service-role delivery API that was never
> built; `0033` restores scoped browser writes (owner/admin/assigned salesperson can
> schedule, the assigned driver can complete) and moves the order-status flip + audit
> row into a SECURITY DEFINER trigger. Apply it before using the dispatch board.

### Multi-order deliveries (`0040`) — a THREE-STEP rollout, in this order

A delivery can now carry finished pieces from several orders and several customers (one
lorry, the Central Table off ORD-1 and the Sofa off ORD-2). The order of these steps is
load-bearing — doing them out of order breaks the dispatch board in production.

1. **Push `0040_multi_order_deliveries.sql`.** Purely additive and safe to apply on its
   own: `deliveries.order_id` stays NOT NULL and trigger-derived, and
   `delivery_items.received` defaults to TRUE, so the currently deployed API and dashboard
   keep working unchanged. Nothing about their behaviour changes until step 2.
2. **Deploy the API, then the dashboard.** The challan moved from the delivery to a new
   `delivery_consignments` row — one per (delivery, customer), i.e. one per challan — so
   `/api/documents/challan/{id}` now takes a **consignment** id. The GET falls back to the
   pre-0040 document key, so challans already rendered stay downloadable. API first: the
   new dashboard calls the new routes.
3. **Promote `supabase/migrations_pending/0041`, then (after a release of soak) `0042`.**
   These retire the old single-order write path and drop `deliveries.order_id`. They live
   outside `supabase/migrations/` on purpose — `supabase db push` applies everything in that
   directory, and pushing `0042` before step 2 is live would drop a column the deployed code
   still reads. See `supabase/migrations_pending/README.md` for each one's gate.

New in `0040` and worth knowing before UAT: `orders.fulfillment_status`
(`not_delivered` / `partially_delivered` / `fully_delivered`) plus the `order_fulfillment`
view. It is a SEPARATE column from `orders.status` — an order sits at `ready` while it is
part-shipped, and the pipeline enum is deliberately untouched. The dispatch board's order
picker filters on it, so a part-delivered order stays schedulable.

### Performance pass — one deploy-order rule: API before dashboard

The dashboard's batched image signing (`lib/media/actions.ts::getMediaUrls`) now calls a new
route, **`POST /api/media/urls`**. Deploy the **API first**. A dashboard that is live against
an older API gets a 404 from it and renders placeholder tiles instead of photos — line-item
thumbnails and the production galleries — with the rest of every page unaffected. Nothing
breaks permanently and no data is at risk; it self-heals the moment the API is up.

The other changes in that pass need no coordination: HTTP routes now share one pooled DB
connection instead of opening (and discarding) a TLS connection per request — see
`apps/api/src/database.py` and the `DB_POOL_*` settings, which have working defaults, so
there is nothing to set. If `DATABASE_URL` is ever repointed at Supabase's **transaction**
pooler (port 6543), set `DB_DISABLE_PREPARED_STATEMENT_CACHE=true` at the same time; the
deployed URL is the session pooler (5432), where the default is both safe and faster.

### Read-path indexes (`0043`) — push any time, no deploy coupling

`0043_read_path_indexes.sql` is pure performance: `create extension pg_trgm` plus indexes,
every statement `if not exists`. No schema, policy or data change, nothing in the app
depends on it having run, and re-running it is a no-op. Safe to push on its own, before or
after any of the steps above.

What it fixes, all of it measured off the actual read paths:

- `audit_log` had **no index at all**, so the "Order Timeline" card sequentially scanned an
  append-only table that only grows.
- The orders and quotations lists sort by `created_at desc` with no index — every page,
  including page 1, sorted the whole table to return 25 rows.
- The list search box does `ilike '%term%'`, which no btree index can serve. `pg_trgm` GIN
  indexes on `customers.name/phone/wa_id`, `orders.order_no` and `quotations.quote_no`
  replace three sequential scans per search.
- Photo reads filter on `status = 'ready'`, which the existing `media_entity_idx` (0025)
  does not cover.

It lands **ahead of** `migrations_pending/0041`/`0042`, so promoting those later is an
out-of-order push (`supabase db push` may need `--include-all`). That is inherent to
holding them back and nothing in `0043` touches what they change.

**Ops step, unchanged from `0037`:** sync the challan counter with their paper book before
the first challan is generated, or the app starts at `T.F 1` and duplicates numbers they
have already issued by hand:

```sql
insert into doc_series (series, fiscal_year, last_no) values ('CHL', 'ALL', 66)
on conflict (series, fiscal_year) do update set last_no = excluded.last_no;
```

---

## TRACK A — Railway env vars: replace every placeholder (YOU · ~30 min)

Placeholders still live: `DATABASE_URL`, `WA_TOKEN`, `WA_APP_SECRET` (missing), `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_API_KEY`, `EDGE_API_KEY`, `DASHBOARD_URL`. Nothing works until these are real.

### A1. Generate the two internal keys (2 min)
Terminal on your Mac:
```bash
openssl rand -hex 32   # run once → this is DASHBOARD_API_KEY
openssl rand -hex 32   # run again → this is EDGE_API_KEY
```
Save both in your password manager. Never paste into any chat.

### A2. Get the real DATABASE_URL (5 min)
1. supabase.com → your Topaz project → **Settings → Database**
2. Section **Connection string** → tab **URI** → dropdown **Session pooler** (NOT direct, NOT transaction pooler)
3. Copy. It looks like: `postgresql://postgres.abcdefgh:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
4. Replace `[PASSWORD]` with your DB password (Settings → Database → Reset database password if lost)
5. **Change prefix** `postgresql://` → `postgresql+asyncpg://` (asyncpg driver requirement)

### A3. Get the permanent WA_TOKEN (10 min) — CRITICAL
If your current token came from the App Dashboard "temporary access token" box, it dies in 24h. You need a **System User permanent token**:
1. business.facebook.com → **Settings (gear) → Users → System users**
2. **Add** → name `topaz-crm-server` → role **Admin** → create
3. **Add assets** → Apps → select your app → Full control; also assign the "Topaz furniture" WABA if listed
4. **Generate new token** → select your app → expiry **Never** → permissions: check `whatsapp_business_messaging` + `whatsapp_business_management` → Generate
5. Copy once (never shown again) → password manager

### A4. Get WA_APP_SECRET (2 min)
developers.facebook.com → your app → **App settings → Basic** → **App secret → Show**. Without this, webhook POSTs return 503 (fail-closed by design).

### A5. Get SUPABASE_SERVICE_ROLE_KEY (1 min)
Supabase → **Settings → API** → `service_role` key (the secret one, not anon).

### A6. Fill variables in Railway (10 min)
For EACH of api / worker / beat → **Variables** tab (or use Railway "Shared Variables" at environment level once, then reference):
```
DATABASE_URL                = postgresql+asyncpg://... (from A2)
WA_TOKEN                    = (from A3)
WA_APP_SECRET               = (from A4)
WA_PHONE_NUMBER_ID          = 1189429440922862
WA_WEBHOOK_VERIFY_TOKEN     = (rotate: new random string — old one was exposed in screenshots)
SUPABASE_SERVICE_ROLE_KEY   = (from A5)
DASHBOARD_API_KEY           = (first key from A1)
EDGE_API_KEY                = (second key from A1)
DASHBOARD_URL               = http://localhost:3000 for now — real value after Track D
```
Keep the already-correct ones: `REDIS_URL=${{Redis.REDIS_URL}}`, MATCH_THRESHOLD 0.45, NEW_THRESHOLD 0.30, HNSW_EF_SEARCH 40, ENROLLMENT_PENDING_WINDOW_SECONDS 120, WELCOME_FOLLOWUP_DELAY_MINUTES 120, FOLLOWUP_BATCH_SIZE 25, FOLLOWUP_STALE_DAYS 3.

### A7. Redeploy + verify (5 min)
1. Redeploy all three services
2. api → Deploy Logs: must show `Application startup complete`
3. worker logs: Celery banner + 7 tasks listed, no traceback
4. Because you rotated the verify token, **update Meta webhook config** (App Dashboard → WhatsApp → Configuration → Edit) with the new token, re-verify
5. Terminal:
```bash
curl "https://api-production-c6189.up.railway.app/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=NEW_TOKEN&hub.challenge=cp1"
```
Must return `cp1`.

**✅ CHECKPOINT 1: api boots clean + webhook challenge echoes.** Stuck? → Prompt P2.

---

## TRACK B — Apply migration 0006 (YOU 10 min, or AI-assisted)

Prod DB has migrations 0001–0005; `0006_visits_captured_at.sql` never pushed.

Easiest path (SQL editor):
1. Open `supabase/migrations/0006_visits_captured_at.sql` in your editor, copy contents
2. Supabase → **SQL Editor** → New query → paste → **Run**
3. Verify: Table editor → `visits` → column `captured_at` exists

CLI alternative: `supabase link --project-ref <ref>` then `supabase db push` (pushes any unapplied). AI help → Prompt P1.

**✅ CHECKPOINT 2: `visits.captured_at` column exists in prod.**

---

## TRACK C — WhatsApp: from registered to messaging (YOU · ~45 min + template approval wait)

### C1. Subscribe webhooks toggle (2 min)
App Dashboard → the Production setup screen where you registered → "Topaz furniture" card → **Subscribe webhooks** toggle ON (it was OFF in your screenshot). Without it, inbound messages never reach the server.

### C2. Two-step PIN (2 min)
WhatsApp Manager → Phone numbers → +91 63563 20206 → Settings → **Two-step verification** → set 6-digit PIN → save in password manager. (If registration already forced one, just record it.)

### C3. Inbound test (5 min) — proves the whole receive path
1. From your personal phone, WhatsApp a message ("test inbound") to +91 63563 20206
2. Railway → api → Deploy Logs: expect a webhook POST line, no 401/503
3. worker logs: inbound processing (customer created / message stored)
4. Supabase → Table editor → `messages`: your text is there
Fail modes: 503 = WA_APP_SECRET wrong · nothing arrives = C1 toggle off or webhook fields missing `messages`.

### C4. Outbound + status test (5 min)
Reply from the system (via API or once dashboard is live). Confirm: message arrives on your phone; `statuses` webhook updates the row sent→delivered→read. Guided version → Prompt P5.

### C5. Message templates (15 min to submit; approval minutes–48h)
WhatsApp Manager → **Message templates** → Create:
- Name `topaz_welcome` · Category **Utility** · Language English (create Gujarati twin later)
- Body: `Hello {{1}}, thank you for visiting Topaz Furniture! We're delighted to help you furnish your space. Your advisor {{2}} will assist you personally. Reply here anytime.`
- Submit. Repeat for a follow-up template if you want cadence messages outside the 24h window from day one.
- Register the approved names/text in `apps/api/src/services/templates.py` → Prompt P6.

### C6. Business verification (start now, runs in background — days)
business.facebook.com → Security Centre → **Start verification** (GST certificate / registration docs). Unverified = display-name limits + low messaging tier; verification unlocks scale. Not blocking for pilot.

**✅ CHECKPOINT 3: inbound message lands in `messages` table + outbound reaches your phone with status updates.**

---

## TRACK D — Dashboard deploy to Vercel (YOU · ~45 min)

### D1. Import (5 min)
vercel.com → **Add New → Project** → Import `darshil320/TOPAZ-CRM` → **Root Directory: `apps/dashboard`** → Framework auto-detects Next.js.

### D2. Env vars (5 min) — before first deploy
```
NEXT_PUBLIC_SUPABASE_URL      = https://<ref>.supabase.co        (Supabase → Settings → API)
NEXT_PUBLIC_SUPABASE_ANON_KEY = (anon public key, same page)
TOPAZ_API_URL                 = https://api-production-c6189.up.railway.app
DASHBOARD_API_KEY             = (same value as Railway A1)
```

### D3. Deploy → note the URL (e.g. `topaz-crm.vercel.app`). Custom domain like `topaz.dmcdigital.in` optional: Vercel → Domains → add + CNAME.

### D4. Close the loop (5 min)
- Railway (all 3 services): `DASHBOARD_URL` = the Vercel URL → redeploy
- Supabase → **Auth → URL Configuration**: Site URL = Vercel URL; add it to Redirect URLs

### D5. Phone-OTP login needs an SMS provider (15 min)
Supabase → **Auth → Providers → Phone** → enable → choose Twilio (Account SID, Auth token, From/Messaging Service SID — twilio.com signup, ~₹0.5–1/SMS) → save.
No Twilio yet? **Auth → Phone → Test OTPs**: add your + Hemant's numbers with a fixed code — works for pilot, replace before real staff onboarding.

### D6. Smoke test
Open Vercel URL on your phone → login via OTP → customers list renders → open a customer → thread loads. Errors → Prompt P3 with the exact message.

**✅ CHECKPOINT 4: login from a phone works, data renders.**

---

## TRACK E — Hardware: camera + kiosk on-site (YOU physical · AI configs · ~half day)

### E1. Shopping list (buy once)
| Item | Spec | ~Cost |
|---|---|---|
| Mini-PC (edge host) | i5 8th-gen+ / Ryzen 5, 8GB RAM, SSD, Ubuntu or Windows; refurb fine | ₹15–25K |
| Camera | Logitech C920/C925e/C930e USB (simplest) — or reuse existing CCTV if RTSP stream accessible | ₹5–8K / ₹0 |
| Kiosk tablet | Any Android 10+, 8–10", on Wi-Fi | ₹10–15K |
| UPS (recommended) | keeps mini-PC + router alive through cuts | ₹3–5K |

### E2. Bench test at YOUR office first (1–2h) — never debug on-site
1. Mini-PC: install Python 3.11+, `git clone` the repo
2. `cd apps/edge && pip install -e .` (deps incl. insightface/onnxruntime pull ~500MB first run)
3. Create `apps/edge/.env`:
```
API_URL=https://api-production-c6189.up.railway.app
API_KEY=<EDGE_API_KEY from A1>
CAMERA_SOURCE=0
CAMERA_ID=entrance-1
CONSENT_MODE=open          # bench only — attaches test token to every detection
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from A5>
```
4. Run worker, sit in front of webcam → expect `202 accepted` POSTs in edge logs, visit rows in Supabase, salesperson alert on WhatsApp
5. Autostart service (survives reboot) → Prompt P4 generates it

**✅ CHECKPOINT 5: bench detection → visit row → WhatsApp alert, end-to-end.**

### E3. On-site install (half day at showroom)
1. Camera at entrance: height ~1.8–2.2m, facing incoming faces, avoid strong backlight from the door (face toward interior light); test angle with live preview
2. Mini-PC near it (LAN > Wi-Fi), autostart verified after a reboot
3. **Flip `CONSENT_MODE=open` → `kiosk`** — production consent seam (§19-E): camera only enrolls faces that came through kiosk consent
4. Kiosk tablet: open dashboard kiosk URL in Chrome → Add to Home screen → Android **app pinning** (Settings → Security → Pin app) so staff can't wander off
5. Walk-through with staff: enroll yourself at kiosk → walk out, walk in → REPEAT alert fires

---

## TRACK F — End-to-end integration test (PAIR · 1–2h before go-live)

Run all five flows with me live (Prompt P5): tell me "start F, flow 1" and paste log lines as they happen.

| # | Flow | Pass when |
|---|---|---|
| 1 | New walk-in | face → visit row (NEW) → salesperson WhatsApp alert < 30s |
| 2 | Kiosk enrollment | consent + customer row → face linked on next detection → welcome followup scheduled (+120 min) |
| 3 | Repeat visit | same face → REPEAT alert with name + last-visit context |
| 4 | Cadence | due followup sent by beat (free-form inside 24h window; template outside) |
| 5 | Inbound reply | customer msg → stored → AI draft → salesperson alerted |

**✅ CHECKPOINT 6: 5/5 pass → cleared for go-live.**

---

## TRACK G — Go-live & handover (YOU)

1. Training session 1: Hemant + sales staff — kiosk enrollment, reading alerts, replying from dashboard
2. Week-1 monitoring: Railway logs daily; `messages` + `visits` tables sanity; watch for template rejections
3. Backups: Supabase → Database → Backups — confirm daily backups on (PITR needs Pro plan; recommended)
4. Rotate any secret that ever appeared in a screenshot/chat (verify token done in A6; audit WA token, keys)
5. Handover sheet to Hemant: what the system does, who to call, what staff must do daily
6. Sign-off → invoice per SOW → collect the 1–2 referral names agreed at signing

---

## PROMPTS LIBRARY — paste into Claude Code (this project)

Efficiency rules: **one track per ask** · paste the exact error line, not whole logs · say the step ID (e.g. "A7 failing") · screenshots only when a UI is the problem.

**P1 — migration push**
> Track B: guide me through applying supabase/migrations/0006 to prod. I'll use [SQL editor | CLI]. Verify with me that visits.captured_at exists after.

**P2 — Railway boot debug**
> Track A step A7: api failing to start. Error line: `<paste exact line>`. Env vars set: <list names only, no values>. Diagnose + exact fix.

**P3 — Vercel deploy debug**
> Track D: dashboard deploy issue at step <D1–D6>. Error: `<exact message>`. Fix it.

**P4 — edge autostart service**
> Track E step E2.5: generate the autostart service for apps/edge on <Ubuntu systemd | Windows>. Include restart-on-crash and log file location, and tell me exactly where to put it and how to enable + verify after reboot.

**P5 — guided E2E test session**
> Track F: run me through the 5 integration flows one at a time. For each: tell me exactly what to do physically, what log/table to watch, and confirm pass/fail before the next. I'll paste what I see.

**P6 — register approved templates**
> Track C step C5: template `<name>` approved by Meta with body: `<paste final approved text>`. Register it in services/templates.py so the cadence engine can use it, and confirm which followups will use it.

**P7 — checkpoint audit**
> Verify Checkpoint <n> for me: list the exact checks, I'll run them and paste outputs, you confirm green or tell me what's broken.

---

## Dependency map

```
A (env) ──► B (migration) ──► C (WhatsApp live) ──► F (E2E) ──► G (go-live)
   │                              ▲
   └──► D (dashboard) ────────────┤
   └──► E (hardware bench ► on-site) ─┘
```
A blocks everything. B, C, D can run same day. E is independent until F needs it. F needs C + D + E-bench. Go-live needs all.
