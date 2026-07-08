# 06 — Roles, RLS completion, admin screens

PLAN MODE REQUIRED (security). USER personally reviews RLS matrix.

## RLS matrix (implement + test)
| Table | salesperson | accounts | workshop_manager | delivery | owner/admin |
|---|---|---|---|---|---|
| quotations/items | own customers RW | read all | none | none | all |
| orders/items | own customers RW | read all | assigned items read (2B) | read delivery-relevant | all |
| payments | own customers read | RW (no update/delete) | none | none | all |
| payment_schedules | read own | RW | none | none | all |
| products | read | read | none | none | RW |
| doc_series/documents | via parent | via parent | none | none | all |

Write policies in migration `0013b_rls_phase2a.sql` (or amend originals if not yet pushed to prod — check STATE.md). Extend `apps/api/tests/test_rls.py`: new seeded users per role in rls_support, ≥12 assertions (accounts cannot UPDATE payments; sales blind to other sales' quotes; workshop role sees no money tables).

## Dashboard role routing
- After login, route by role: sales→/dashboard, accounts→/dashboard/payments, owner/admin→/owner, workshop_manager→/workshop (2B placeholder), delivery→/dashboard/deliveries (2C placeholder → simple orders-ready list for now).
- Nav component renders per role. Middleware guard per route group.

## Admin screens (`/owner/admin/**` — owner/admin only)
- Staff: list salespersons, add (name, whatsapp, role), deactivate. Writes via Supabase (RLS admin-only) or small FastAPI route — choose Supabase direct.
- Products: CRUD table.
- Settings: GST rates per product default, quote terms preset, validity days, schedule policy presets, receipt-send toggle. Store in a `app_settings(key text pk, value jsonb)` table (tiny migration) read by config-aware endpoints; API reads with 60s cache.
- Templates registry: read-only list of WhatsApp templates + Meta status field (manual mark approved/pending).

## Files to touch
- supabase/migrations/0013b_rls_phase2a.sql (+app_settings)
- apps/api/tests/rls_support.py + test_rls.py (extend)
- apps/dashboard/src/middleware.ts, nav component, app/owner/admin/** (new), login redirect logic
- apps/api settings loader for app_settings where server-side needed (gst defaults already per-product; quote terms fetched by builder)

## Gates
- test_rls.py full suite green on temp DB (with auth stub + seeded roles). security-reviewer agent on public endpoints + payments + RLS diff. USER reads matrix and signs off in STATE.md decisions.
