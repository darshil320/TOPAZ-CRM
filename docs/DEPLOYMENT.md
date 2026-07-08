# Topaz CRM Phase 1 — Production Deployment Map

Single source of truth for going live. Work one track at a time, in order.
Legend: **YOU** = only Darshil can do (portals, hardware, people) · **AI** = paste the prompt from §Prompts into Claude Code · **PAIR** = you drive, AI guides live.

## Status snapshot (2026-07-07)

DONE: all Phase 1 code built + empirically verified · repo on GitHub (darshil320/TOPAZ-CRM) · Railway project `cooperative-wisdom`: api + worker + beat + Redis all Online · api public domain `api-production-c6189.up.railway.app` · Meta webhook configured + verified (GET challenge green) · WhatsApp number +91 63563 20206 REGISTERED on "Topaz furniture" WABA (ID 27846807084905593, phone ID 1261681507021925) · payment method step showed green.

REMAINING: Tracks A–G below.

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
WA_PHONE_NUMBER_ID          = 1261681507021925
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
