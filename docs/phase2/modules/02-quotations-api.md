# 02 — Quotations API + builder UI

## API (apps/api/src/api/quotations.py — new router, register in main.py)

Auth: dashboard server actions call with API-Key = DASHBOARD_API_KEY (pattern: `_verify_dashboard_key` in api/whatsapp.py). Alternative chosen for Phase 2: dashboard talks to Supabase directly for reads (RLS-protected), FastAPI only for writes with side effects. KEEP IT SIMPLE: reads via Supabase client in Next.js server components; writes via FastAPI.

Routes:
- `POST /api/quotations` — create draft. Body: customer_id, items[], discount, terms, valid_until?, place_of_supply?. Server: compute totals via gst.py, allocate QTN number, insert. Returns quotation.
- `PUT /api/quotations/{id}` — update DRAFT only (409 otherwise). Recompute totals server-side always; never trust client totals.
- `POST /api/quotations/{id}/revise` — clone to new row (new number suffix? NO — new QTN number, revision_of=old, revision_no+1), status draft. Old row untouched.
- `DELETE /api/quotations/{id}` — draft only, soft: status expired.
- (send/approve endpoints live in module 03)

## Repos (apps/api/src/repositories/quotation_repo.py — new)
- create_quotation(session, header, items) — single transaction, returns id+quote_no
- get_quotation(session, id) with items
- update_draft(session, id, header, items) — delete+reinsert items
- clone_for_revision(session, id) -> new id
- list summary function optional (dashboard reads via Supabase instead)

Decimal/datetime rules per PLAN.md. Pydantic request models in the router (or packages/shared if edge/dashboard share — not needed; keep in router).

## Dashboard (apps/dashboard/src/app/dashboard/quotes/)
- `page.tsx` — list: number, customer, date, total, status chip, revision badge. Reads via server component + Supabase client (RLS).
- `new/page.tsx` + `QuoteBuilder.tsx` (client) — customer picker (search existing), line-item editor rows (product picker → prefills desc/hsn/rate/price, or free text), qty/unit/price inputs, live totals panel (client-side mirror of gst calc for display; server recomputes on save), discount, terms textarea (preset from config), Save Draft button → server action → POST /api/quotations.
- `[id]/page.tsx` — detail: items table, totals block, status, revision chain links, Edit (draft), Revise, (Send button module 03).
- `actions.ts` — server actions wrapping FastAPI calls; pattern + 10s AbortSignal timeout from customers/[id]/actions.ts.

## Files to touch
- apps/api/src/api/quotations.py, src/repositories/quotation_repo.py (new); src/main.py (register router)
- apps/dashboard/src/app/dashboard/quotes/** (new)
- apps/api/tests/test_quotations_empirical.py (create→revise→update guards on temp DB)

## Gates
- Empirical: create with 3 mixed-rate items → totals match test_gst golden values; revise chain integrity; draft-only guard 409.
- tsc clean. Builder produces correct totals for golden case #1 (manual check in demo).
