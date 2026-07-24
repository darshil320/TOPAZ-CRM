# Phase 2 build state

Update at END of every session. This file is the cross-session memory.

## Module status

| # | Module | Status | Session notes |
|---|---|---|---|
| 01 | foundation (migrations 0011-0019, doc_series, GST engine) | done | gates green (111 pytest incl. 24 GST goldens, numbering concurrency, payments immutability, outstanding view); not pushed to prod |
| 02 | quotations-api | done | BACKEND (prior session): quotation_repo + /api/quotations router + deps + 4 empirical tests green. UI (this session): quotes list + QuoteBuilder (create/edit) + detail (items/totals/revision chain) + actions.ts (create/update/revise/delete → FastAPI, 10s timeout, API-Key). Client GST mirror `lib/gst.ts` matches gst.py goldens (3500→140/140/3780 intra; 280 inter; 350-disc→126/126/3402). types.ts extended (products/quotations/quotation_items). Nav item added. tsc clean. |
| 03 | quote-pdf-send-approval | in-progress | CODE done + verified: pdf.py (Playwright, lazy), quote_html.py + templates/quotation.html (Jinja, amber brand, amount-in-words), storage.py (private bucket + signed URL), tasks/pdf.render_quotation_pdf, tasks/quotes.send_quotation + notify_quote_decision (24h-window branch, WA_MEDIA_ENABLED flag), send_wa_document, api/public.py (token-gated GET/approve/reject, idempotent, IP-stamped, pipeline upsert), /quotations/{id}/send. Dashboard: /q/[token] public page + ApproveActions, Send button, middleware excludes /q. Tests: test_num_words + test_quote_html (11 pure) + test_quotations_send_empirical (4, green on pgtest). tsc clean. MANUAL GATES REMAINING: real PDF render (needs `playwright install chromium`), real WA doc/template send to phone (WA-MEDIA-SPIKE), Meta template submission (quote_sent, quote_approved_confirm). |
| 04 | orders-pipeline | in-progress | CODE done + verified: order_repo (create_from_quote approved-only + copies totals verbatim + advance=DEFAULT_ADVANCE_PCT; create_order manual; set_status optimistic + audit reason; patch_order), services/order_status.py (pure transition map), api/orders.py (from-quote/manual/PATCH status guarded 409/PATCH order). Dashboard: orders list (+order_outstanding), order detail (items/totals/outstanding/schedule/payments/timeline) + OrderStatusActions, pipeline kanban (/dashboard/pipeline, HTML5 drag → moveCustomerStage), "Create order" on approved quote. types.ts extended (orders/order_items/payments/payment_schedules/order_outstanding view); nav Orders+Board. Tests: test_order_status (4 pure) + test_orders_empirical (3, green on pgtest). tsc clean. |
| 05 | payments | todo | |
| 06 | roles-rls-admin | todo | |
| 07 | 2a-hardening (E2E, seed, UAT prep, reviews) | todo | |
| 08 | workshops-media (migrations 0014-0016) | todo | |
| 09 | production-engine | todo | |
| 10 | workshop-pwa | todo | |
| 11 | production-board | todo | |
| 12 | notifications-watchdog | todo | |
| 13 | 2b-hardening | todo | |

Status values: todo / in-progress / done / verified (gates green + user demo passed).

## Decisions log
<!-- append: date · module · decision · why -->
- 2026-07-04 · setup · Plan docs created from execution-plan report; conventions pinned in PLAN.md.
- 2026-07-22 · setup · Migrations RENUMBERED 0007→0011… (Phase 1 M5/M6B took 0007-0010). Ledger + specs to reflect. EXECUTION_PLAN_2A_2B.md §0.1.
- 2026-07-22 · setup · Built Docker-free empirical harness `apps/api/scripts/pgtest.sh` (temp PG15 cluster + pgvector + anon/authenticated/service_role + auth.uid() stub + all migrations). Runs RLS + repo suites without `supabase start`. PG15 chosen for prod parity (security_invoker views).
- 2026-07-22 · 01 · pipeline_stage strategy = FULL REMAP (user decision). Added 8 new stages (0018), data-migrated old→new (0019: new→inquiry, talking→design_discussion, follow_up→negotiation, won→order_confirmed, lost kept). Old enum values retained (PG can't drop) but unused. Updated 8 shipped dashboard files to new vocabulary; est-value/win analytics re-pointed won→order_confirmed. tsc clean.
- 2026-07-22 · 01 · GST rounding: per-line pre-tax rounded 2dp then summed; document discount pro-rated at full precision by line share; CGST/SGST/IGST accumulated full-precision, rounded half-up 2dp at document level. 24 golden cases pin exact values.
- 2026-07-22 · 01 · Payments hard-immutable via `forbid_payment_mutation()` trigger (blocks UPDATE/DELETE incl. service role) + insert-only grant. Corrections = refund rows only.
- 2026-07-22 · 01 · GST inclusive/exclusive + HSN-per-family still UNANSWERED by client → built on documented fallback (exclusive, 18%, 9403). Goldens must be re-confirmed with Hemant before 2A go-live (module 07).
- 2026-07-24 · 02 · Module 02 UI shipped (quotes list/builder/detail + actions.ts); client GST mirror lib/gst.ts matches gst.py goldens; committed 46e0129.
- 2026-07-24 · scope · SCOPE FLAG RAISED (docs/phase2/PLAN_2A_SELL.md §0): every SOW on file (topaz-sow-v1 §4, superseded crm-sow-3L §3) EXCLUDES orders + payment tracking, reserving them for a "separate Phase 2 SOW"; the current signed CRM SOW (crm-sow-1.5L) does not name quote/order/payment. VENDOR DECISION (Darshil, DMC): proceed to build M03–M07 (quote send/approval, orders, payments, roles/RLS, hardening) now; vendor owns papering the Phase-2 SOW/CR before invoicing. Flag recorded per CLAUDE.md — not silently dropped. Feature-flag customer WA delivery until WA-MEDIA-SPIKE + Meta verification clear.

## Discoveries for later modules
<!-- things found mid-build that affect future modules -->
- (none yet)

## Open questions for client (Hemant) — blocks marked modules
- Product catalog / price list exists? (02; free-text lines work without it)
- Prices GST-inclusive or exclusive? HSN per product family (9401 vs 9403)? (01 — needed before GST golden tests final)
- Payment schedule policy (e.g. 50/40/10)? Receipts auto-sent to customer on WhatsApp? (05)
- Staff list + roles + phone numbers (06)
- Workshop list, managers, phones; vendor workshops get logins? (08)
- 11 production stage names EN + Gujarati confirmed (08 seed)
- Quote terms & conditions text + validity days (03)
- Turnover under ₹5cr confirmed (invoice scope) (05/06)

## External dependencies
- Meta: Phase 1 number registration + templates pending (Phase 1 chat owns this)
- 2A WhatsApp templates to submit at module 03: quote_sent (doc), quote_approved_confirm, payment_received, payment_due
- 2B templates to submit at module 08: production_started, production_completed (image), ready_for_dispatch

## Environment
- Prod Supabase project = Phase 1's. Staging project: NOT created yet (user action; prerequisite before pushing 0011-0019 to any hosted DB).
- Migration head (repo AND prod) = **0010** (Phase 1 M5/M6B shipped 0007-0010). Phase 2 migrations 0011-0019 are BUILT on branch `phase2` and verified on the local PG15 harness but **NOT pushed to prod/staging** — that happens at module 07 go-live after backup/PITR (0019 is destructive on live pipeline data).
- Local test DB: no `supabase start`/Docker needed — run `apps/api/scripts/pgtest.sh` (spins temp PG15 + pgvector, applies all migrations, runs pytest).
