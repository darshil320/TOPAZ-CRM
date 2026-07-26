# Topaz CRM — Phase 2 Master Plan (2A "Sell" + 2B "Make")

Condensed build plan. Full rationale lives in the DMC feasibility + execution reports (external).
This file + `modules/*.md` + `STATE.md` are the ONLY context a build session needs.

## What Phase 2 adds (deltas only)

| Deployable | Additions |
|---|---|
| `apps/dashboard` (Next.js 14 App Router) | Role-routed sections: quotes, orders, payments, pipeline kanban, admin; public `/q/[token]` quote-approval page (no auth); `/workshop` PWA route group (2B) |
| `apps/api` (FastAPI) | Routers: `quotations`, `orders`, `payments`, `products`, `admin` (2A); `workshops`, `production`, `media` (2B). Registered in `src/main.py` with `/api` prefix like existing routers |
| Celery (same worker/beat) | Tasks: `pdf.render_document`, `payment reminders` (rides existing followup engine), `production notifications`, `delay_watchdog` (beat), `media_thumbs`. New modules added to `celery_app.py` include list |
| Supabase | Migrations **0007–0016** (see below). RLS + audit triggers in the SAME migration as each table |
| WhatsApp | `send_wa_document()` (media upload + document message) in `tasks/whatsapp.py`; ~10 new templates registered in `services/templates.py` pattern |

Untouched: `apps/edge`, recognition pipeline, kiosk, enrollment/consent flow.

## Locked decisions (do not relitigate)

1. Money: `NUMERIC(12,2)` columns, Python `Decimal`, half-up rounding, GST rounded at document level. Never float.
2. asyncpg params: timestamptz/date params are **native `datetime`/`date` objects, never `.isoformat()` strings** (casts don't help — verified). uuid/jsonb as strings OK (jsonb with `cast(:x AS jsonb)`).
3. Repos: raw SQL via `sqlalchemy.text()` + `make_task_session()` pattern, same as `src/repositories/*.py`. Commit at caller.
4. PDF: HTML template rendered by headless Chromium (Playwright) inside a Celery task; output to Supabase Storage bucket `documents`; row in `documents` table; WhatsApp document send.
5. Numbering: `doc_series` table, `allocate_number(series)` with `SELECT … FOR UPDATE`. Series per fiscal year: `QTN-2627-0001`, `ORD-`, `RCP-`. Never MAX()+1.
6. Quote approval: signed single-use token column (uuid) in URL, public page, audit row + IP/timestamp on approve. Not a digital signature.
7. Media: Supabase Storage, signed upload URLs, client-side compression (`browser-image-compression`), Celery thumbnail task. R2 later, not now.
8. Roles: extend `salespersons.role` CHECK to `('salesperson','owner','admin','accounts','workshop_manager','delivery')`. Reuse phone-OTP auth + `current_salesperson_id()` RLS helper.
9. Workshop app: PWA route group in the same Next.js app. No native app. Gujarati + English labels.
10. State changes guarded server-side (order status, production stage order). Append-only event tables; `current_stage` denormalized by trigger.
11. Payments immutable after insert; corrections = reversal rows. Refund kind requires admin.
12. Tests are gates: GST golden cases, empirical temp-DB repo harness (pattern: create temp DB + stub `auth` schema + apply migrations + run real repo functions), `tests/test_rls.py` extension, `tsc --noEmit` clean.
13. Scope fences: NO inventory, NO accounting ledger/Tally, NO e-invoice IRN (under ₹5cr; keep invoice data e-invoice-ready), NO BOM/capacity planning, NO offline-first.

## GST facts (verified Jul 2026)

- Under ₹5cr turnover: no IRN/e-invoice, no QR mandate. Rule 46 PDF invoice is compliant.
- HSN 4-digit mandatory on B2B lines (9401 seating / 9403 other furniture, 18% default — rates CONFIGURABLE, never hardcoded). Fresh unique series each FY.
- Intra-Gujarat: CGST+SGST split; inter-state: IGST (place_of_supply drives it).
- E-way bill: intra-city Ahmedabad exempt; Gujarat city-to-city > ₹50k required → delivery module shows reminder only.

## Migration ledger

**RENUMBERED 2026-07-22:** Phase 1 M5/M6B consumed 0007–0010 (unclaimed_queue,
customer_alerts_muted, customer_interest_summary, alerts) after this doc was first
written. Prod/repo migration head = **0010**. Phase 2 therefore starts at **0011**.
The pipeline enum change is split across two files (0018/0019): a value added to an
enum cannot be USED in the same transaction that ADDed it, and Supabase wraps each
migration file in one transaction. See EXECUTION_PLAN_2A_2B §0.1/§0.2.

| Mig | Contents | Module | Status |
|---|---|---|---|
| 0011 | role CHECK expansion + `is_role(text[])` RLS helper | 01 | built |
| 0012 | `doc_series` + `allocate_number()` | 01 | built |
| 0013 | `products` (optional catalog) | 01 | built |
| 0014 | `quotations`, `quotation_items` (+ shared `audit_status_change` trigger) | 01 | built |
| 0015 | `orders`, `order_items` (pure 2A — no production cols) | 01 | built |
| 0016 | `payments` (immutable), `payment_schedules`, `order_outstanding` view (security_invoker) | 01 | built |
| 0017 | `documents` registry | 01 | built |
| 0018 | pipeline_stage: ADD VALUE ×8 (own transaction) | 01 | built |
| 0019 | pipeline_stage: data migration old→new + default | 01 | built |
| 0020 | RLS phase-2a completion + `app_settings` | 06 | built |
| 0021 | publish `messages` to realtime | 03 | built |
| 0022 | partial unique index: one order per quotation | 04 | built |
| 0023 | `workshops` + `is_workshop_manager_of()` | 08 | built |
| 0024 | `production_stage_defs` + seed, production cols on `order_items`, `order_item_assignments`, `production_events` (append-only), denorm trigger, realtime publication | 08 | built |
| 0025 | `media` polymorphic + deferred `production_events.media_id` FK | 08 | built |

Realtime for `production_events` is folded into 0024 (guarded, idempotent) — module 11
needs no migration. Storage bucket policies are NOT migrations: see
`supabase/storage/0025_media_policies.sql` (pgtest's bare cluster has no `storage` schema).

## Build order (one module = one session)

2A: 01-foundation → 02-quotations-api → 03-quote-pdf-send-approval → 04-orders-pipeline → 05-payments → 06-roles-rls-admin → 07-2a-hardening
2B: 08-workshops-media → 09-production-engine → 10-workshop-pwa → 11-production-board → 12-notifications-watchdog → 13-2b-hardening

Plan-mode-required modules (money/RLS/schema): **01, 05, 06, 13**.

## Existing-code conventions (reference by path, don't re-derive)

- Router pattern + API-Key auth: `apps/api/src/api/enrollment.py`
- Repo pattern: `apps/api/src/repositories/followup_repo.py` (claim/locks), `message_repo.py`
- Celery task pattern + DB access: `apps/api/src/tasks/followup.py`
- WhatsApp send/template/webhook: `apps/api/src/tasks/whatsapp.py`, `src/services/templates.py`, `src/api/whatsapp.py`
- Config: `apps/api/src/config.py` (pydantic-settings; add new knobs there)
- Dashboard server action + §19-G (secrets server-side only): `apps/dashboard/src/app/dashboard/customers/[id]/actions.ts`
- Realtime subscription: `apps/dashboard/src/hooks/useVisitAlerts.ts`
- RLS test harness: `apps/api/tests/test_rls.py` + `conftest.py` (opt-in `seeded` fixture)
- Empirical DB harness: temp DB + `CREATE SCHEMA auth; CREATE FUNCTION auth.uid()...` stub + apply all migrations + run real repo functions

## Client inputs pending (see STATE.md open questions)

Catalog/price list · GST inclusive-vs-exclusive + HSN per family · staff list + roles · workshop list + managers · payment schedule policy · quote terms text · 11 Gujarati stage names · receipt-to-customer yes/no.
