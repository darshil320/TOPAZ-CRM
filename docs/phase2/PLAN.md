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

| Mig | Contents | Module |
|---|---|---|
| 0007 | role CHECK expansion + `is_role(text[])` RLS helper | 01 |
| 0008 | `doc_series` + `allocate_number()` | 01 |
| 0009 | `products` (optional catalog) | 01 |
| 0010 | `quotations`, `quotation_items` | 01 |
| 0011 | `orders`, `order_items` | 01 |
| 0012 | `payments`, `payment_schedules`, `order_outstanding` view | 01 |
| 0013 | pipeline_stage enum expansion + data migration; `documents` registry | 01 |
| 0014 | `workshops` | 08 |
| 0015 | `production_stage_defs` + seed, `order_item_assignments`, `production_events`, stage triggers | 08/09 |
| 0016 | `media` polymorphic | 08 |

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
