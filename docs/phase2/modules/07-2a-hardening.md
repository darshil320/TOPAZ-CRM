# 07 — 2A hardening: E2E, seed, UAT prep, reviews, go-live

## E2E (Playwright, apps/dashboard)
- Set up @playwright/test if absent. One spec, the money path: login (sales) → create customer → build quote (2 items, discount) → send (mock WA: config flag or intercept) → open /q/[token] → approve → order auto-exists → login accounts → record advance → outstanding correct → receipt document row exists.
- Run against local stack (supabase start + api + worker). Makefile/README section `make e2e`.

## Seed script
- apps/api/scripts/seed_demo.py: 10 customers, 5 products, 6 quotes across statuses, 4 orders, payments/schedules — for demos + UAT. Idempotent.

## Reviews (this module only)
- code-reviewer agent: full 2A diff (modules 01-06), empirical-verify top findings, fix CRITICAL/HIGH.
- security-reviewer agent: public quote endpoints, payments, RLS, storage bucket policies (documents bucket private, signed URLs only).

## UAT + docs
- docs/phase2/UAT_2A.md: scripted scenarios per role (sales: quote→send→revise; accounts: record/refund-request/outstanding; owner: admin settings). Checkbox format, Gujarati-friendly wording.
- docs/phase2/TRAINING_2A.md one-pager per role.
- Update apps/api/README + dashboard README run sections if drifted.

## Go-live checklist (execute with USER)
- Staging → prod migration push (0007-0013b) after backup/PITR check
- Prod env vars: SUPABASE_SERVICE_ROLE_KEY (api), settings rows, playwright/chromium in prod image
- Meta templates approved? (STATE.md external) — if not, quote send degrades to window-only; OK to launch
- First real quote with Hemant present

## Gates
- E2E green locally. Reviewer findings closed. UAT executed by Topaz staff (USER runs). STATE.md all 2A modules → verified. Milestone invoice trigger.
