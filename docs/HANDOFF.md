# Topaz CRM — Session Handoff Prompt

Paste the block below into a fresh Claude chat. Secrets are intentionally masked —
real values live in the local `.env` files (paths given), Railway, and Vercel. Never
commit real secret values into this file.

---

```
You are picking up an in-flight production project. Read this fully before acting. I (the user) will grant every access you ask for — Railway, Vercel, Supabase, GitHub, local Docker. You do the heavy lifting from here.

## PROJECT
Topaz Showroom Intelligence — face-recognition + WhatsApp sales-conversion CRM for Topaz Furniture (Surat showroom), built by DMC Digital. Monorepo at /Users/darshillashkari/Downloads/topaz-showroom-intelligence. Read CLAUDE.md first — binding domain/legal constraints (DPDPA consent-first, WhatsApp 24h window, price-from-DB-not-embeddings). docs/DEPLOYMENT.md is the authoritative live-status doc (NOT the README/MONOREPO status columns — stale, partly fixed).

## HOW TO WORK
- Deploy model: git push to `main` auto-deploys BOTH Railway (api/worker/beat) and Vercel (dashboard). NO staging. A push = live production. Build + typecheck + test locally first, push, then verify the live deploy rolled out (~1-2 min) before saying it's done.
- Prod DB migrations: `supabase db push` (linked, ref hebnvwhuiqvbigluqfyz). Always `--dry-run` first.
- RLS is the security boundary (browser talks to Supabase directly). Any schema/policy change MUST pass apps/api/tests/test_rls.py against local Supabase (`supabase db reset` then pytest) BEFORE pushing to prod. A leaked policy = real customer-data breach. Already caught one bug this way.
- Immutability, small files, explicit error handling, no silently-swallowed query errors (that bug already bit us).

## LIVE INFRA
- GitHub: darshil320/TOPAZ-CRM, branch main (auto-deploy).
- Railway project "cooperative-wisdom": api + worker + beat + Redis, all Online. API: https://api-production-c6189.up.railway.app
- Vercel: https://topaz-crm.vercel.app
- Supabase prod ref hebnvwhuiqvbigluqfyz (ap-south-1). Migrations 0001–0007 applied.
- WhatsApp: Meta Cloud API DIRECT (not AiSensy — deliberate pivot, ADR-06). Number +91 63563 20206, WABA registered. CLAUDE.md constraint #4 literally says "use a BSP" but is struck through with the real decision — don't "fix" it back.
- Edge worker (apps/edge): runs on a mini-PC/laptop, NOT yet a deployed service. No systemd/Dockerfile autostart yet (Track E step E2.5, open). CONSENT_MODE must be `kiosk` in production, `open` only for bench.

## ENVIRONMENT VARIABLES
Real secret values are NOT in this prompt. They live in the local .env files below (read them directly — you're on the same machine), in Railway (api/worker/beat service vars), and Vercel (dashboard project vars). Pull secrets from there; never paste them into committed files. `<SECRET:...>` = fetch from the named source.

apps/edge/.env  (edge worker — bench values shown; flip CONSENT_MODE to kiosk on-site)
  API_URL=https://api-production-c6189.up.railway.app
  CAMERA_SOURCE=0                       # 0 = first USB camera (Logitech)
  QUALITY_FLOOR=0.2                     # lower = more permissive for testing
  COOLDOWN_SECONDS=30
  FRAME_POLL_SECONDS=0.5
  CAMERA_ID=entrance-1
  CONSENT_MODE=open                     # BENCH ONLY. Production = kiosk
  SUPABASE_URL=https://hebnvwhuiqvbigluqfyz.supabase.co
  API_KEY=<SECRET: EDGE_API_KEY — apps/edge/.env, also Railway api/worker/beat>
  SUPABASE_SERVICE_ROLE_KEY=<SECRET: service_role — apps/edge/.env, Railway, Supabase→Settings→API. Never expose to browser>

apps/api/.env  (FastAPI + Celery; local dev — prod copies live in Railway)
  DATABASE_URL=postgresql+asyncpg://postgres.hebnvwhuiqvbigluqfyz:<SECRET:DB_PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres   # session pooler, asyncpg scheme required
  REDIS_URL=redis://localhost:6379/0    # local; prod uses Railway ${{Redis.REDIS_URL}}
  EDGE_API_KEY=<SECRET — apps/api/.env, Railway>
  DASHBOARD_API_KEY=<SECRET — apps/api/.env, Railway, Vercel>
  MATCH_THRESHOLD=0.45                  # synthetic-tuned; recalibrate from real camera (§19-D)
  NEW_THRESHOLD=0.30
  HNSW_EF_SEARCH=40
  WA_PHONE_NUMBER_ID=1189429440922862   # NOTE: docs/DEPLOYMENT.md says 1261681507021925 — reconcile which is live
  WA_TOKEN=<SECRET: Meta System User token — Railway. Expires if it was a temp token; confirm it's a permanent System User token>
  WA_WEBHOOK_VERIFY_TOKEN=<SECRET — apps/api/.env, Railway, Meta webhook config>
  WA_APP_SECRET=<SECRET: Meta App Secret — apps/api/.env, Railway. Webhook POSTs 503 without it (fail-closed)>
  DASHBOARD_URL=https://topaz-crm.vercel.app/
  SUPABASE_SERVICE_ROLE_KEY=<SECRET — as above>
  # ANTHROPIC_API_KEY=<SECRET: optional — AI draft falls back to a template if unset>

apps/dashboard/.env.local  (Next.js; prod copies live in Vercel)
  NEXT_PUBLIC_SUPABASE_URL=https://hebnvwhuiqvbigluqfyz.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<public anon key — Supabase→Settings→API. Shipped to browser by design; RLS protects data>
  TOPAZ_API_URL=https://api-production-c6189.up.railway.app
  DASHBOARD_API_KEY=<SECRET — must equal the Railway/api value>

Local test DB (RLS suite): postgresql://postgres:postgres@127.0.0.1:54322/postgres (supabase start).
Config source of truth: apps/api/src/config.py (pydantic Settings), apps/edge/src/config.py. Any secret that ever appeared in a screenshot/chat should be rotated (see DEPLOYMENT.md Track G #4).

## WHAT'S BUILT & DEPLOYED
Full loop works in code: kiosk consent enrollment → edge face detect/match → consent-gated embedding storage → NEW/REPEAT/UNCERTAIN banding → REPEAT WhatsApp alert to primary salesperson → dashboard (Supabase Realtime) → AI-draft reply → human approve → send.

Recent session added (all live):
- Claim queue /dashboard/walkins — active salesperson sees unclaimed customers, claims via claim_customer() RPC (atomic first-tap-wins). Migration 0007 added the RLS policies making unclaimed rows visible, via a SECURITY DEFINER helper customer_has_active_primary (an inline-subquery version leaked assigned customers — caught by test_rls.py).
- Salesperson onboarding /owner/salespersons (owner-only) add/deactivate + POST /api/auth/link-salesperson auto-links a pre-seeded row to a Supabase auth user by phone on first OTP login.
- Owner collaborator-add on customer page ("Assigned Team"), upsert-based (re-adding a removed collaborator won't 409).
- Persistent role-aware Sidebar + header role badge.
- Fixed ambiguous PostgREST embed (customer_assignments has two FKs into salespersons: salesperson_id + added_by) that silently returned empty team lists.

## "REPEAT WITHOUT KIOSK TOUCH" — ALREADY IMPLEMENTED, DO NOT REBUILD
Repeat/known faces get matched + alerted with no kiosk touch; new/unknown faces still need the kiosk enrollment flow. This is already how the code works:
- apps/edge/src/main.py _handle_detection posts EVERY detection to /api/recognition regardless of consent token.
- apps/api/src/tasks/recognition.py _process: ANN match + REPEAT banding + salesperson alert are unconditional; consent_token is read ONLY in the NEW/UNCERTAIN enrollment branch.
Your job: VERIFY live (Track F bench run), not re-architect.
CRITICAL CAVEAT: reliability depends on MATCH_THRESHOLD/NEW_THRESHOLD (0.45/0.30, synthetic-tuned, services/matching.py §19-D). A misclassified repeat lands in UNCERTAIN, which does NOT alert. Prioritize threshold calibration from real on-camera captures.

## VERIFIED THIS SESSION
- apps/api unit tests: 32 passing (no DB).
- apps/api/tests/test_rls.py: 20/20 against local Supabase (incl. new 0007 policies).
- Dashboard: tsc --noEmit clean, next build clean.
- Live smoke: /api/auth/link-salesperson returns 401 (deployed); new dashboard routes redirect to /login (deployed). Claim queue + salesperson admin verified against real prod data.

## KNOWN GAPS / REMAINING WORK (prioritized)
1. Track F end-to-end field test (docs/DEPLOYMENT.md) — 5 flows on a real camera. Biggest unknown. Includes verifying repeat-without-kiosk + tuning thresholds.
2. Edge autostart service (Track E E2.5) — no systemd unit / Dockerfile. Reboot silently kills recognition. Ask user: Ubuntu systemd or Windows; add restart-on-crash + log location.
3. Consent withdrawal has NO UI/API path. DB cascade trigger purges face_embeddings but NOT the Storage face-crop files (visits.photo_key) — DPDPA gap, finish before go-live.
4. coverage_requests (primary-on-leave coverage) — schema + RLS only, no repo/task/UI.
5. conversations table — defined + RLS'd, ZERO reads/writes. Decide: build meeting-notes or drop (destructive migration — get explicit user sign-off before dropping).
6. Primary-salesperson self-serve handoff/collaborator-add still owner-only (RLS ca_insert owner-only by design). Build a service-role path if salespersons should self-serve.
7. Threshold calibration (see caveat).

## FIRST ACTIONS
1. Read CLAUDE.md + docs/DEPLOYMENT.md fully.
2. Confirm live state: git log, `railway status`, `supabase migration list`, curl API health + a new route.
3. Ask user which OS for edge autostart (Track E E2.5) — most self-contained high-value unblock.
4. Plan Track F with user (they run the physical camera; you tell them exactly what to watch, confirm pass/fail per flow).

Do not rebuild working features. When unsure whether something exists, grep/read the code first. Flag out-of-SOW-scope work instead of silently building it.
```
