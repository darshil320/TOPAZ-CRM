# Phase 2B / Module 14 — go-live checklist (Make + Transit)

Gate for handing daily use to Topaz staff unsupervised. Owner (Darshil) runs this with
Hemant present, same process as `GO_LIVE_2A.md`. **Do not skip the BLOCKERS.**

**Honest status as of 2026-07-27: code is live on prod and empirically green (323
tests), but this has NOT been through the review/staging process 2A went through.
Safe for a supervised pilot with 1-2 real staff today. Not yet safe to hand off with
no oversight — the items below are why.**

## 0. Contract (must clear first)

- [ ] **Change Request covering module 14** (workshop staff hierarchy, multi-workshop
      routing, transit app) — none of it is in the signed SOW/PRD/EXECUTION_PLAN §4
      modules 08–13. Built at the client's explicit instruction ("go create
      everything, ignore the build blocker", 2026-07-27) — technical work done,
      commercial paperwork still outstanding. Same gap already open for job cards.

## 1. Security BLOCKERS

- [ ] **DPDPA consent-withdrawal purge — CRITICAL, real legal risk, unrelated to
      module 14 but still open.** Withdrawal has no UI/API path; the DB cascade
      purges `face_embeddings` but not the Storage face-crop files or `media` bucket
      objects for withdrawn customers. Flagged in `CLAUDE.md` as a go-live blocker
      before this session started — still true. **Fix before wider rollout**, not
      specific to today's pilot but the single highest-risk open item in the whole
      system.
- [ ] **code-reviewer + security-reviewer have never run on the 2B/module-14
      surface.** Module 08's own gate note says the same reviewers "died on an API
      session limit" and 08 never formally closed; modules 09/14 (built entirely
      this session) have had zero independent review. 323 passing tests prove the
      code does what it was designed to do — they do not substitute for an
      adversarial security pass on RLS/authz boundaries.
- [ ] **LOW — rate limiting on public + dashboard-key routes.** Flagged repeatedly
      since 2A (M07), never fixed. Lower urgency than the two above.
- [ ] **`api/auth.py::link_salesperson` trusts a body-supplied `auth_uid`**, gated
      only by the shared dashboard key, not a verified token — the one identity-link
      path that still works this way. Pre-existing, flagged at the same JWT-hardening
      pass that fixed HIGH-3/HIGH-4 for 2A, never revisited.

## 2. Manual / external gates

- [x] Meta templates approved: 2A's `payment_due` / `quote_sent` /
      `quote_approved_confirm`, plus module 14's `topaz_transfer_incoming` /
      `topaz_transfer_status` / `topaz_production_alert` (confirmed 2026-07-27).
- [x] `WA_MEDIA_ENABLED=true` on prod; Chromium/PDF render confirmed live.
- [ ] **Real device field test never run.** Module 10's own gate ("Lighthouse PWA
      installable pass; manual full stage walk on a real Android phone with 2 real
      managers, feedback logged, one redesign loop budgeted") has not happened —
      today's testing was one owner login on a laptop browser. Do this with the
      first 1-2 real workshop staff before wider rollout.
- [ ] Money-path E2E (2A) still marked MANUAL — needs a live-stack credential run.

## 3. Environment

- [x] **No staging/UAT — deliberate, client-confirmed operating decision
      (2026-07-27).** `TOPAZ-CRM-UAT` (`gpwdyikitstzqewvbcoi`) exists but is stale at
      migration `0022` and is not being kept in sync; every change (module 14
      included) is developed and tested directly against **production** going
      forward. Recorded here as a decision, not an oversight — but it raises the
      floor on the next two items: with no staging rehearsal, prod's own safety net
      (backups, migration diligence, empirical tests before every push) is *the*
      only thing standing between a mistake and real customer/order/payment data.
- [ ] **No backup / PITR on prod** (Supabase free plan). A bad migration or an
      accidental delete is unrecoverable beyond whatever manual snapshot was taken
      by hand (this session kept a pre-`0023` migration-state + row-count reference
      in scratchpad, not a real backup). Consider the paid tier now that real
      production orders/customers/payments live here.
- [ ] **No error tracking / uptime monitoring configured** anywhere in the stack
      (no Sentry or equivalent mentioned in any env file). A Celery task failing
      silently (e.g. a WhatsApp send) is invisible until a human notices nothing
      arrived.
- [ ] Beat schedule confirmed live: `payment-reminders` (10:00 IST),
      `transit-watchdog` (09:00 IST, module 14).

## 4. What's actually done (module 14 specifically)

- [x] Migrations `0029`–`0032` on prod, verified column-by-column against a schema
      drift discovered mid-session (see STATE.md 2026-07-27 decisions — an earlier,
      unreviewed draft of `production_events` predated this repo's migrations and
      had to be reconciled).
- [x] `/api/routing`, `/api/transfers`, staff endpoints on `/api/workshops` — all
      live, confirmed via direct probe (422 not 404) after the Railway deploy.
- [x] Dashboard: `/workshop` (rebuilt, roster-scoped), `/transit` (new, courier-only),
      admin Staff + Route Templates panels, Plan-route on order detail + allocate.
- [x] 323 tests passing (pure + empirical), `tsc` clean.
- [ ] **Role-based login redirect still doesn't route workshop_manager/delivery
      anywhere useful.** `app/page.tsx` sends `owner` → `/owner`, everyone else →
      `/dashboard` (the sales view) — unchanged since module 06's own "PARTIAL" note.
      A workshop lead or courier logging in for the first time lands on a screen
      with nothing for them and must be told to navigate to `/workshop` or
      `/transit` manually. **Bookmark it for them during training (below) — don't
      rely on the login flow to land them correctly.**

## 5. Client inputs to confirm

- [ ] **Real workshop staff.** Zero `workshop_manager` and zero `delivery`
      salespersons rows exist yet — today's testing used the owner login for
      everything. Before a real pilot: add real people via `/owner/salespersons`,
      appoint them via `/owner/admin` → Workshop Staff.
- [ ] Gujarati stage labels — still placeholders pending Hemant's confirmed wording
      (module 08 open question, unresolved).
- [ ] Rework policy — confirmed NOT modelled (client decision, 2026-07-26): a failed
      QC does not regress a stage; it becomes `blocked` with a note.

## 6. Acceptance

- [ ] Field test (§2) executed with 2 real workshop staff + 1 real courier.
- [ ] Security-reviewer pass on the 2B/14 surface, specifically the money-blind
      boundary for `workshop_manager`/`delivery` and the destination-before-receive
      read widening in `wt_select` (0031).
- [ ] STATE.md modules 08–14 → `verified`.
- [ ] Change Request (§0) signed.
