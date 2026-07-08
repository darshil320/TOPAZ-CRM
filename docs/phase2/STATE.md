# Phase 2 build state

Update at END of every session. This file is the cross-session memory.

## Module status

| # | Module | Status | Session notes |
|---|---|---|---|
| 01 | foundation (migrations 0007-0013, doc_series, GST engine) | todo | |
| 02 | quotations-api | todo | |
| 03 | quote-pdf-send-approval | todo | |
| 04 | orders-pipeline | todo | |
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
- Prod Supabase project = Phase 1's. Staging project: NOT created yet (user action, module 01 prerequisite).
- Migrations 0001–0006 applied in prod as of 2026-07-04? 0006 (visits.captured_at) push still pending — verify before 0007.
