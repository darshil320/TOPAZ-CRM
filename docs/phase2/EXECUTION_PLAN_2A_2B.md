# Topaz CRM — Phase 2 Execution Plan (2A "Sell" → 2B "Make" → 2C "Deliver")

**Status:** Draft for build. **Owner:** DMC Digital (Darshil). **Last updated:** 2026-07-22.
**Authoritative scope:** SOW `topaz-sow-v1.md` › Quote › PRD `topaz-prd-v2.md` › this plan.
**Companion docs (do not duplicate):** `docs/phase2/PLAN.md` (locked decisions, GST facts, conventions), `docs/phase2/STATE.md` (cross-session memory), `docs/phase2/modules/*.md` (per-module specs), `docs/DEPLOYMENT.md` (Phase 1 go-live map).

> This document is the buildable expansion of the condensed `PLAN.md`. It adds: a
> timeline with effort + parallelization, explicit API/data contracts, a consolidated
> risk register, per-phase testing/deployment/rollback, and phase-boundary handoffs.
> One module = one build session (per `SESSION_PROTOCOL.md`). Where a module spec is
> already precise, this plan references it rather than restating it.

---

## 0. Corrections that MUST be applied before any Phase 2 build starts

These are discrepancies between the phase2 docs (authored 2026-07-04) and the repo/prod as of 2026-07-22. They are P0 — building without fixing them corrupts prod.

### 0.1 Migration renumbering (BLOCKER)

`PLAN.md`'s migration ledger assigns Phase 2 to `0007–0016`. **Those numbers are already taken.** Phase 1 M5/M6B consumed them *after* the phase2 docs were written:

| Repo file (already applied to prod) | Phase 1 feature |
|---|---|
| `0007_unclaimed_queue.sql` | salesperson self-serve claim queue |
| `0008_customer_alerts_muted.sql` | mute arrival alerts per customer |
| `0009_customer_interest_summary.sql` | customer interest summary |
| `0010_alerts.sql` | intent-trigger alerts (M5/M6B) |

**Current migration head (repo AND prod) = `0010`.** Phase 2 therefore starts at **`0011`**. Apply this remap everywhere (PLAN.md ledger, every module spec, STATE.md):

| PLAN.md said | Use instead | Module |
|---|---|---|
| 0007_roles | **0011_roles** | 01 |
| 0008_doc_series | **0012_doc_series** | 01 |
| 0009_products | **0013_products** | 01 |
| 0010_quotations | **0014_quotations** | 01 |
| 0011_orders | **0015_orders** | 01 |
| 0012_payments | **0016_payments** | 01 |
| 0013_pipeline_documents | **0017_pipeline_documents** | 01 |
| 0013b_rls_phase2a (+app_settings) | **0018_rls_phase2a** | 06 |
| 0014_workshops | **0023_workshops** | 08 |
| 0015_production | **0024_production** | 08 |
| 0016_media | **0025_media** | 08 |
| (realtime publication, if needed) | **0022_realtime_production** | 11 |

**Action:** first task of module 01 is a docs-only patch updating PLAN.md's ledger, STATE.md's "Environment" line, and each module spec's migration filenames. Also correct STATE.md: it says "0001–0006 applied, 0006 pending" — stale; **prod is at 0010** and all are applied.

### 0.2 `pipeline_stage` enum migration will break Phase 1 analytics

Current enum (migration 0001): `('new','talking','follow_up','won','lost')`. Module 01 (`0017_pipeline_documents`) ADDs 8 values and data-migrates old→new: `new→inquiry`, `talking→design_discussion`, `follow_up→negotiation`, `won→order_confirmed`, `lost` unchanged.

**Risk:** the owner analytics shipped in commit `b099378` ("est. value counts only won customers' budgets") queries `pipeline_stage = 'won'`. If we migrate `won→order_confirmed` without updating that query, the estimated-pipeline number silently drops to zero.

**Mandatory sub-tasks in module 01/06:**
- `grep -rn "'won'\|'talking'\|'follow_up'\|\"new\"\|pipeline_stage" apps/api apps/dashboard` — enumerate every read of the old values.
- Update all found queries to the new vocabulary **in the same PR as the data migration.**
- Postgres constraint: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction, and a newly added enum value cannot be used in the *same* transaction that added it. Split into: migration step A (ADD VALUEs, autocommit, no txn wrapper), then step B (the `UPDATE ... SET stage = 'inquiry'` data migration) as a separate statement/file. Supabase runs each file; keep the ADD VALUEs in their own file with no `BEGIN/COMMIT`.

### 0.3 WhatsApp media send is the critical-path external dependency

Modules **03** (quote PDF document), **08** (media uploads), **11** (share photos to customer), **12** (`production_completed` image template) all require WhatsApp **media** send to work end-to-end, plus **Meta Business Verification** for template delivery outside the 24h window.

Good news (verified in code): `apps/api/src/tasks/whatsapp.py` already ships `send_wa_image()` and `_upload_media_to_meta()` (Meta media upload → message). Module 03 only needs `send_wa_document()` (a thin variant reusing `_upload_media_to_meta`), not a from-scratch media stack. Module 11's `send_wa_image` **already exists** — wire it, don't rebuild.

Bad news (per memory `topaz-media-messaging-gap`): two-way **text** is verified working; **media** send has not been verified against the live number, and Meta Business Verification (DEPLOYMENT.md Track C6) is still pending — outbound template delivery outside the 24h window is currently blocked. Until verification clears, all "send to customer" paths degrade to *window-only* (free-form inside 24h) and templates queue as pending.

**Action:** a one-off spike ("WA-MEDIA-SPIKE", 0.5d, OPS+BE) before module 03 that (a) sends one real document and one real image to Darshil's phone via the live number, (b) confirms `statuses` webhook fires, (c) records the result in STATE.md. If it fails, module 03's approval flow still ships (public approval page + status), but customer-facing document delivery is feature-flagged off until Meta verification completes. See Risk R1.

---

## 1. Timeline overview

Baseline = **one senior full-stack dev**. "2-dev" column = elapsed time if a Backend (BE: FastAPI/migrations/Celery) and Frontend (FE: Next.js/dashboard) dev split each module after the API contract is frozen. Client/OPS tasks (Meta, env, inputs, UAT) run in parallel and are not on the dev critical path unless noted.

### 1.1 Milestone table

| # | Module | Gate type | Dev-days (1 dev) | 2-dev elapsed | Hard predecessors | Client/OPS blocker |
|---|---|---|---|---|---|---|
| — | Pre-flight (renumber, staging, WA-MEDIA-SPIKE) | — | 1.0 | 1.0 | — | staging project created (OPS) |
| 01 | Foundation (0011–0017, GST, numbering) | **plan-mode + db-review** | 4.5 | 3.5 | pre-flight | GST inclusive/exclusive + HSN per family (CLIENT) |
| 02 | Quotations API + builder UI | contract-freeze | 4.5 | 3.0 | 01 | catalog/price list optional (CLIENT) |
| 03 | Quote PDF + WA send + approval | demo | 5.5 | 4.0 | 02, WA-MEDIA-SPIKE | quote terms text (CLIENT); submit 2A templates (OPS) |
| 04 | Orders + pipeline kanban | demo | 4.5 | 3.0 | 02 (03 for auto-approve path) | — |
| 05 | Payments, schedules, reminders | **plan-mode + sec-review** | 5.0 | 4.0 | 04 | schedule policy, receipt-to-customer, turnover<₹5cr (CLIENT) |
| 06 | Roles, RLS, admin screens | **plan-mode + sec-review** | 4.5 | 3.5 | 02–05 (tables exist) | staff list + roles + phones (CLIENT) |
| 07 | 2A hardening (E2E, seed, UAT, go-live) | **milestone + invoice** | 4.0 + UAT | 4.0 + UAT | 01–06 | UAT run by Topaz staff (CLIENT, ~5 business days) |
| — | **2A subtotal** | | **~29 dev-days** | **~19 elapsed** | | + ~1 week UAT |
| 08 | Workshops, media, allocation (0023–0025) | db-review | 4.5 | 3.5 | 07 (orders live) | workshop list + Gujarati stage names (CLIENT); submit 2B templates (OPS) |
| 09 | Production state machine + events | demo | 4.5 | 4.0 | 08 | — |
| 10 | Workshop PWA (My Queue) | field-test | 5.5 | 4.5 | 09 | 2 real managers for field test (CLIENT) |
| 11 | Live board + order tabs (+PWA fixes) | demo | 4.5 | 3.0 | 10 | field feedback from 10 (CLIENT) |
| 12 | Notifications + delay watchdog | demo | 3.5 | 3.0 | 09 (11 for image share) | 2B templates approved (OPS) |
| 13 | 2B hardening (RLS, E2E, pilot, rollout) | **milestone + invoice** | 4.0 + pilot | 4.0 + pilot | 08–12 | 2-week pilot, 1 workshop (CLIENT) |
| — | **2B subtotal** | | **~26.5 dev-days** | **~22 elapsed** | | + ~2 week pilot |
| 2C | Deliver & optimize (delivery, reports, feedback) | **needs Change Request** | scope-only | — | 13 | SOW §11 CR + sign-off (CLIENT) |

**Totals:** ~55.5 dev-days of build (~11 working weeks solo). With a BE/FE split on parallelizable modules, ~41 elapsed dev-days (~8 weeks). Add ~1 week 2A UAT + ~2 week 2B pilot (calendar, overlap with next dev where safe) → **realistic 12–16 calendar weeks solo, 9–11 weeks with 2 devs**, from pre-flight to 2B sign-off.

### 1.2 Dependency graph

```
pre-flight ─► 01 foundation ─┬─► 02 quotations ─┬─► 03 pdf/send/approval ─┐
                             │                  └─► 04 orders/pipeline ───┼─► 05 payments ─┐
                             │                                            │                │
   WA-MEDIA-SPIKE ───────────┘ (unblocks 03 customer delivery)            │                ▼
                                                                          └───────────► 06 roles/RLS/admin
                                                                                             │
                                                                          07 2A hardening ◄──┘  ──►[2A GO-LIVE + invoice]
                                                                                             │
                            08 workshops/media ◄─────────────────────────────────────────────┘ (needs orders live)
                                    │
                                    ▼
                            09 production engine ─┬─► 10 workshop PWA ─► 11 live board ─┐
                                                  └─────────────────────► 12 notifications/watchdog
                                                                                        │
                                                                     13 2B hardening ◄──┘  ──►[2B PILOT + rollout + invoice]
                                                                                        │
                                                                                        ▼
                                                                          2C (Change Request)
```

**Parallelization levers (what can run concurrently):**
- **BE/FE split within a module.** Once the API contract (§ per-module "API contract") is frozen, FE builds the dashboard pages against a stub while BE finishes the repo + migration. This is the primary accelerator; it assumes the contract is agreed on day 1 of the module.
- **Client inputs are gathered ahead of need.** All CLIENT blockers (GST config, staff list, workshop list, Gujarati names, terms text, schedule policy) should be collected during pre-flight/module 01 so they never sit on the critical path. Track in STATE.md open questions.
- **Meta template approvals run async.** Submit 2A templates during module 03, 2B templates during module 08. Approval takes minutes–48h and is not on the dev path; sends degrade to window-only until approved.
- **06 (RLS) can start as soon as tables land.** RLS policies per table can be drafted incrementally as 02–05 create their tables, then consolidated + tested in module 06. Don't wait for all tables if you have a spare RLS reviewer.
- **2B foundation (08 migrations, workshop/Gujarati inputs) can be drafted during 07 UAT week** so 2B starts hot the moment 2A signs off.

**What is strictly sequential (do not parallelize):**
- 01 must fully land (schema + GST + numbering) before anything writes money.
- 05 (payments) needs 04 (orders) — payments reference `order_id`.
- 09 (state machine) needs 08 (workshops/assignments/events tables).
- 10 → 11 (board reflects PWA events); 11's first task is applying 10's field feedback.
- 13 pilot needs all of 08–12 verified.

---

## 2. Global prerequisites & cross-cutting concerns

Applies to every module; not repeated per-module.

### 2.1 Environments

| Env | What | Owner | Status |
|---|---|---|---|
| Staging Supabase | separate project, mirror of prod schema; all Phase 2 migrations land here first | OPS | **NOT created — module 01 prerequisite** |
| Prod Supabase | Phase 1's project; head at `0010` | OPS | live |
| Railway (api/worker/beat/Redis) | Phase 1's `cooperative-wisdom` project; extend includes + beat + env | OPS | live |
| Vercel (dashboard) | Phase 1's project, root `apps/dashboard` | OPS | live |
| Local | `supabase start` + api + worker + beat for E2E (modules 07/13) | dev | per app README |

**Rule:** every migration is applied to **staging first**, verified, then prod (after backup/PITR check). Never push an unreviewed migration to prod. `database-reviewer` agent runs on each migration in modules 01 and 08.

### 2.2 Config knobs to add (`apps/api/src/config.py`)

Already present (reuse, do not re-add): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_API_KEY`, `DASHBOARD_URL`, `WA_*`, followup knobs. **Add:**

| Knob | Default | Module | Purpose |
|---|---|---|---|
| `HOME_STATE` | `'GJ'` | 01 | intra vs inter-state GST split |
| `QUOTE_VALIDITY_DAYS` | `15` | 01 | default quote validity |
| `DOCUMENTS_BUCKET` | `'documents'` | 03 | Supabase Storage bucket for PDFs |
| `DEFAULT_ADVANCE_PCT` | `50` | 04 | advance_expected on order-from-quote |
| `SEND_RECEIPTS_TO_CUSTOMER` | `false` | 05 | gate receipt WA send until client answers |
| `MEDIA_BUCKET` | `'media'` | 08 | Storage bucket for production photos |
| `STAGE_STALE_DAYS` | `4` | 12 | watchdog: no-update threshold |
| `WATCHDOG_OWNER_WA` / digest knobs | env | 12 | owner digest recipient |
| `WA_MEDIA_ENABLED` | `false` | 03 | feature-flag customer media delivery until WA-MEDIA-SPIKE passes |

No hardcoded thresholds/recipients/templates at decision points (project rule). GST rates live per-product (`products.gst_rate`) + `app_settings` defaults, never literals.

### 2.3 Shared code conventions (reference, don't re-derive)

| Concern | Reference file |
|---|---|
| Router + API-Key auth | `apps/api/src/api/enrollment.py` (`_verify_*` dep), `api/whatsapp.py` |
| Repo pattern (raw SQL `text()` + `make_task_session()`, commit at caller) | `repositories/followup_repo.py`, `message_repo.py` |
| Celery task + DB access | `tasks/followup.py`; app factory `tasks/celery_app.py` |
| WhatsApp send/upload/template | `tasks/whatsapp.py` (`_post_wa_payload`, `_upload_media_to_meta`, `send_wa_image`, `send_wa_template`, `send_salesperson_alert`) |
| Template registry | `services/templates.py` (`FollowupTemplate` frozen dataclass, `FOLLOWUP_TEMPLATES`, `meta_template_params`) |
| 24h window branch | `services/wa_window.py` |
| Dashboard server action + secret-server-side rule (§19-G) | `app/dashboard/customers/[id]/actions.ts` (10s `AbortSignal`) |
| Realtime subscription | `hooks/useVisitAlerts.ts` |
| RLS test harness | `tests/test_rls.py` + `conftest.py` (`seeded` fixture), `rls_support.py` |
| Empirical DB harness | temp DB + `CREATE SCHEMA auth; CREATE FUNCTION auth.uid()…` stub + apply all migrations + run real repo fns |

### 2.4 Locked money/data rules (from PLAN.md — enforced, non-negotiable)

`NUMERIC(12,2)` + Python `Decimal` + half-up, GST rounded at document level, never float. asyncpg: timestamptz/date params as native `datetime`/`date` (never `.isoformat()`); uuid/jsonb as strings (jsonb with `cast(:x AS jsonb)`). Numbering via `allocate_number()` `FOR UPDATE`, never `MAX()+1`. Payments immutable (no UPDATE/DELETE; corrections = reversal rows). Append-only event tables; denorm maintained by trigger. Server always recomputes totals — never trust client.

### 2.5 Scope fences (building any of these = SOW breach without a CR)

NO inventory, NO accounting ledger/Tally sync, NO e-invoice/IRN (turnover <₹5cr; keep data e-invoice-*ready*), NO BOM/capacity planning, NO offline-first PWA queue (v1 network-first only). If a task drifts here, stop and raise a Change Request (SOW §11, ₹8,000/day T&M).

### 2.6 Client inputs register (gather during pre-flight → module 01)

Blocks the marked module until answered; log answers in STATE.md decisions.

| Input | Blocks | Fallback if unanswered |
|---|---|---|
| GST inclusive vs exclusive; HSN per family (9401 seating / 9403 other) | 01 (GST golden tests) | assume exclusive, 18%, 9403; re-run goldens on answer |
| Product catalog / price list | 02 | free-text line items work without it |
| Quote terms & conditions text + validity days | 03 | config default `QUOTE_VALIDITY_DAYS=15`, placeholder terms |
| Payment schedule policy (e.g. 50/40/10); receipts auto-sent? | 05 | `DEFAULT_ADVANCE_PCT=50`, `SEND_RECEIPTS_TO_CUSTOMER=false` |
| Staff list + roles + phone numbers | 06 | seed Darshil+Hemant only; add rest at go-live |
| Turnover under ₹5cr confirmed | 05/06 | assume yes (no IRN); revisit if wrong = CR |
| Workshop list + managers + phones; vendor logins? | 08 | empty table; seed at 2B start |
| 11 production stage names EN + Gujarati | 08 seed | English + placeholder Gujarati; hot-swap labels later |

---

## 3. PHASE 2A — "Sell" (quote → approve → order → pay)

**Phase objective:** a salesperson can build a GST-correct quotation, send it as a branded PDF over WhatsApp, the customer approves it from their phone, it converts to an order in one click, and accounts records payments against a schedule with immutable receipts — all role-scoped by RLS, demoable end-to-end.

**Phase success criteria (verifiable):**
- E2E spec (module 07) green: login→quote→send→approve→order→payment→outstanding, locally against real stack.
- GST golden suite (≥20 cases) green; totals in the builder match server to the paisa.
- `test_rls.py` proves cross-role isolation (sales blind to other sales' quotes; accounts can't UPDATE payments; workshop role sees no money).
- All money columns `NUMERIC(12,2)`; zero float in money paths (grep gate).
- Migrations `0011–0018` apply clean on a fresh temp DB and on staging; reversible or forward-fixed.
- 2A UAT executed by Topaz staff; STATE.md modules 01–07 = `verified`.

---

### Module 01 — Foundation (migrations 0011–0017, numbering, GST engine)

> **PLAN MODE REQUIRED.** `database-reviewer` on each migration before push. Spec: `modules/01-foundation.md` (apply §0.1 renumbering).

**Objective / done =** migrations `0011_roles`, `0012_doc_series`, `0013_products`, `0014_quotations`, `0015_orders`, `0016_payments`, `0017_pipeline_documents` apply clean on temp DB + staging; `gst.py` golden suite (≥20 cases) green; `allocate_number()` proven concurrent-safe (two parallel allocations, no dup); pipeline enum migrated with all Phase 1 reads updated (§0.2).

**Prerequisites:** pre-flight done (renumber patch, staging project exists); GST inclusive/exclusive + HSN answer (fallback available); `grep` of old pipeline_stage reads complete.

**Technical scope:**
- **Migrations** (exact DDL in `modules/01-foundation.md`, renumbered): role CHECK → 6 roles + `is_role(text[])` SECURITY DEFINER helper mirroring 0004; `doc_series(series,fiscal_year,last_no)` + `allocate_number(p_series,p_fy)` atomic `INSERT…ON CONFLICT DO UPDATE…RETURNING`; `products`; `quotations`+`quotation_items` (revision chain via `revision_of`, `approval_token uuid`); `orders`+`order_items` (**pure 2A — no workshop/stage columns; those come in 0020**); `payments`+`payment_schedules`+`order_outstanding` view (immutable, no `updated_at`); pipeline enum ADD VALUEs + data migration; `documents` registry.
- **Services (pure, Decimal-only):** `gst.py` (`compute_line`, `compute_document` — discount pro-rated pre-tax, intra→CGST/SGST split, inter→IGST, half-up 2dp at document level); `numbering.py` (`allocate(session, series)` computes FY Apr–Mar `'2627'`, formats `QTN-2627-0001`).
- **Config:** `HOME_STATE`, `QUOTE_VALIDITY_DAYS`.

**Data model (authoritative shapes):** see `modules/01-foundation.md` lines 16–39. Money columns all `NUMERIC(12,2)`. `quotations.status ∈ {draft,sent,viewed,approved,rejected,expired}`; `orders.status ∈ {confirmed,in_production,ready,delivered,installed,closed,cancelled}`; `payments.kind ∈ {advance,stage,final,refund}`.

**Task breakdown:**
1. (0.25d, BE) Docs-only renumber patch (§0.1) + STATE.md env correction. Commit `docs:`.
2. (0.25d, BE) `grep` + list every old-pipeline-stage read; note in STATE.md discoveries. *(gates 0.2)*
3. (1.0d, BE) Write `0011`–`0013` (roles, doc_series, products); `database-reviewer` each; apply to temp DB.
4. (1.0d, BE) `0014`–`0016` (quotations, orders, payments) + `order_outstanding` view; reviewer; temp DB.
5. (0.5d, BE) `0017` pipeline enum (split ADD-VALUE file from data-migration file per §0.2) + `documents`; update Phase 1 reads in same PR.
6. (1.0d, BE) `gst.py` + `tests/test_gst.py` (≥20 goldens: single 18%, mixed 18/5, discount pro-rating, ₹999.995 rounding edge, inter-state, zero-rate, qty decimals). **TDD: goldens first.**
7. (0.5d, BE) `numbering.py` + `tests/test_numbering_empirical.py` (concurrent allocate, no dup).

*Parallelizable:* steps 3–5 are one chain (schema); step 6 (GST) is independent and can be built in parallel by a second dev from the goldens.

**Edge cases & risks:** enum ADD VALUE txn rule (§0.2); FY rollover at Apr 1 (test both sides); rounding at document not line level (goldens must encode this); discount larger than subtotal (clamp, test); `allocate_number` under contention (empirical test is the proof); vendor of GST inclusive pricing changes every golden (get answer early).

**Testing & validation:** `test_gst.py` + `test_numbering_empirical.py` green; all migrations apply clean on fresh temp DB; `quotations`+`items` insert/select smoke via psql; `database-reviewer` sign-off per migration; **user reviews diffs before any staging/prod push**.

**Deployment & rollout:** staging push after reviewer; verify enum values + `allocate_number` on staging; **prod push deferred to module 07 go-live** (batch 0011–0018 together after backup) unless a mid-phase demo needs it. Rollback: migrations are additive except the enum data-migration — keep a down-map (`order_confirmed→won` etc.) documented; enum values can't be dropped, so forward-fix only.

**Handoff to next module:** frozen schema + `gst.compute_document` signature + `numbering.allocate` signature. 02 consumes both. Record GST answer + any convention choices in STATE.md.

---

### Module 02 — Quotations API + builder UI

> Spec: `modules/02-quotations-api.md`. Contract-freeze gate (agree API shape day 1 for BE/FE split).

**Objective / done =** a salesperson builds a quote with mixed-rate line items + discount and saves a draft whose server-computed totals equal the module-01 golden for the same inputs; revise creates a new numbered row with `revision_of` set and the old row frozen; draft-only guards return 409; `tsc` clean.

**Prerequisites:** 01 schema + `gst.py`; catalog optional (free-text works without).

**Technical scope & API contract (`apps/api/src/api/quotations.py`, new router, `/api` prefix):**
```
POST   /api/quotations              body {customer_id, items[], discount, terms?, valid_until?, place_of_supply?}
                                    → server computes totals (gst.py), allocates QTN no, inserts. 201 {quotation}
PUT    /api/quotations/{id}         DRAFT only (else 409). Recompute totals server-side always. 200 {quotation}
POST   /api/quotations/{id}/revise  clone → new QTN no, revision_of=old, revision_no+1, status=draft. 201 {quotation}
DELETE /api/quotations/{id}         draft only, soft (status=expired). 204
```
Auth: dashboard **writes** go through FastAPI with `DASHBOARD_API_KEY` (`_verify_dashboard_key` pattern); dashboard **reads** hit Supabase directly (RLS-protected server components). Pydantic request models in the router. Repo `quotation_repo.py`: `create_quotation` (single txn), `get_quotation` (+items), `update_draft` (delete+reinsert items), `clone_for_revision`.

**Dashboard (`app/dashboard/quotes/`):** `page.tsx` list (no, customer, date, total, status chip, revision badge — Supabase read); `new/page.tsx`+`QuoteBuilder.tsx` (client — customer search picker, line-item rows with product picker prefill or free text, qty/unit/price, **live client-side totals mirror** for display, discount, terms textarea preset from config, Save→server action→POST); `[id]/page.tsx` detail (items, totals, revision chain links, Edit/Revise, Send button stub for 03); `actions.ts` (server actions wrapping FastAPI, 10s AbortSignal).

**Task breakdown:** (0.5d) Pydantic models + contract freeze → (1.0d, BE) repo + create/update/revise/delete + guards → (0.75d, BE) `test_quotations_empirical.py` (create 3 mixed items → totals == golden; revise chain integrity; draft-only 409) → (1.5d, FE) list + builder + detail pages → (0.5d, FE) server actions + wire → (0.25d) tsc + demo golden #1. *BE and FE parallelize after contract freeze (~3.0d elapsed for 2 devs).*

**Edge cases & risks:** client totals drift from server (server is truth; show a "recalculated" note if they differ on save); editing a sent quote (blocked — revise instead); revision explosion (chain UI must stay readable — cap display, link older); customer picker performance on large lists (server-side search).

**Testing:** empirical create/revise/update-guard; tsc clean; builder totals manually checked against golden #1 in demo.

**Deployment:** router registered in `main.py`; no prod schema change (rides 01). Feature is dark until dashboard deploy. Rollback: unregister router.

**Handoff:** quote lifecycle (draft/revise) + `quotation_repo` API. 03 consumes `get_quotation` + `approval_token`; 04 consumes approved quotes for order conversion.

---

### Module 03 — Quote PDF + WhatsApp send + public approval

> Spec: `modules/03-quote-pdf-send-approval.md`. Demo gate. **Depends on WA-MEDIA-SPIKE.**

**Objective / done =** a real quote renders to a branded PDF (>10KB) in Supabase Storage `documents` (private), sends to the customer's WhatsApp (document if `WA_MEDIA_ENABLED` + window/template rules allow, else falls back gracefully), the customer opens `/q/[token]` on their phone and approves, status→`sent`→`approved`, approval is idempotent (double-POST = one audit row), pipeline advances to `order_confirmed`, salesperson gets an internal alert.

**Prerequisites:** 02 (quote exists + `approval_token`); WA-MEDIA-SPIKE result recorded; quote terms text (fallback ok); `documents` bucket created private (OPS); Playwright chromium installed in dev + Dockerfile.

**Technical scope:**
- **PDF:** `services/pdf.py::render_html_to_pdf(html)->bytes` (Playwright chromium; WeasyPrint fallback noted if image bloats container); `services/quote_html.py` (Jinja2 → branded HTML: Topaz amber header, customer block, items table, totals with CGST/SGST-or-IGST, **amount-in-words** helper, terms, validity, signature block); template `src/templates/quotation.html`. Add `playwright` + `jinja2` to `pyproject`; document chromium install in README + `Dockerfile RUN`.
- **Task:** `tasks/pdf.py::render_quotation_pdf(quotation_id)` — load→render→upload Storage `documents` key `quotes/{quote_no}-r{rev}.pdf` (httpx to Storage API, service key)→`documents` row + `quotations.pdf_key`. Register in celery `include`.
- **WA:** `tasks/whatsapp.py::send_wa_document(to, bytes_or_url, filename, caption)->wamid` **reusing `_upload_media_to_meta`** (already exists) then `type=document`. Register `quote_sent` (utility, document header) + `quote_approved_confirm` in `services/templates.py`; Meta submission = OPS.
- **Send + approval:**
```
POST /api/quotations/{id}/send                (dashboard key) ensure PDF (chain render→send), window-aware send, status→sent, message row, audit
GET  /api/public/quotes/{token}               (NO auth) → {customer first name, items, totals, validity, signed pdf url, status}. 404 unknown/expired
POST /api/public/quotes/{token}/approve        (NO auth, idempotent) status+approved_at+approved_ip(X-Forwarded-For)+audit; enqueue customer confirm WA + salesperson alert; pipeline→order_confirmed
POST /api/public/quotes/{token}/reject         (NO auth, idempotent) status=rejected; pipeline→negotiation
```
Public router registered **without** the key dependency. `middleware.ts` matcher **must exclude `/q`**.
- **Dashboard:** `app/q/[token]/page.tsx` (public route group, no auth — mobile-first summary card, PDF view link, Approve / Request Changes → public API, success screen).

**Task breakdown:** (0.5d) WA-MEDIA-SPIKE (OPS+BE, pre-req) → (1.0d, BE) pdf.py + quote_html + template + amount-in-words → (0.75d, BE) render task + Storage upload + documents row → (0.5d, BE) send_wa_document (reuse upload) + template registry → (1.0d, BE) send + public endpoints + idempotency + audit + pipeline upsert → (1.0d, FE) `/q/[token]` public page + middleware exclusion → (0.75d) empirical + demo. *BE-heavy; FE public page parallelizes.*

**Edge cases & risks:** **WA media unverified (R1)** — feature-flag `WA_MEDIA_ENABLED`; if off, approval flow still fully works, only customer document delivery is deferred. Window closed + template not approved → queue as pending, salesperson notified to nudge customer. Token brute force → uuid, uniform 404. Double approve → idempotent (test). PDF render OOM/timeout on Railway → task retry + size cap; WeasyPrint fallback. Chromium missing in prod image → documented `RUN` + boot check. `X-Forwarded-For` spoofing → store as-is for audit only, not trust.

**Testing:** empirical (render golden→bytes>10KB; approve idempotency=one audit; token 404s); manual demo (real quote→WA doc→approve from phone→status+pipeline). OPS: submit templates; approve PDF layout with Hemant (one revision loop budgeted).

**Deployment:** `documents` bucket private + signed-URL-only policy; Playwright in prod image; celery include updated → redeploy worker. Rollback: `WA_MEDIA_ENABLED=false` disables customer delivery without touching approval.

**Handoff:** approved quotes + `approval_token` flow + `documents` registry + `send_wa_document` + PDF task pattern (05 reuses for receipts). 04 converts approved quotes.

---

### Module 04 — Orders + pipeline kanban

> Spec: `modules/04-orders-pipeline.md`. Demo gate.

**Objective / done =** an approved quote converts to an order in one click with header+items+totals copied exactly (byte-for-byte totals match), manual walk-in orders create with correct GST, status transitions are server-guarded (illegal→409, cancel needs reason), and the pipeline kanban shows customers by stage with drag-to-move persisting.

**Prerequisites:** 02 (quotes); 03 for the auto-`order_confirmed` path (order-from-approved-quote); `order_outstanding` view (01).

**Technical scope & contract (`api/orders.py` + `order_repo.py`):**
```
POST  /api/orders/from-quote/{quotation_id}  quote must be approved; copy header+items, allocate ORD no,
                                             advance_expected = grand_total * DEFAULT_ADVANCE_PCT/100, status=confirmed,
                                             pipeline→order_confirmed, audit. 201 {order}
POST  /api/orders                            manual order (same body shape as quote create); totals via gst.py. 201
PATCH /api/orders/{id}/status                guarded map: confirmed→{cancelled,in_production}; in_production→ready;
                                             ready→delivered; delivered→installed; installed→closed. 409 illegal.
                                             reason required for cancelled. audit each.
PATCH /api/orders/{id}                        expected_delivery_date, notes only.
```
**Dashboard:** `orders/page.tsx` (list, status chips, outstanding column from view, filters status/salesperson); `orders/[id]/page.tsx` (tabs: Details, Payments [05 fills], Timeline [audit_log for entity], Documents; status action buttons per map; "Create order" button lands here from approved-quote detail); `pipeline/page.tsx` (9-stage kanban, cards=customers w/ stage-age badge red>7d, drag→Supabase update RLS; auto-moves already done by quote/order events).

**Task breakdown:** (0.5d) contract + transition map constant → (1.0d, BE) order_repo + from-quote + manual + status guard → (0.75d, BE) `test_orders_empirical.py` (conversion copies totals exactly; illegal transition 409; manual totals) → (1.25d, FE) orders list + detail tabs shell → (1.0d, FE) pipeline kanban + drag persist → (0.25d) tsc + demo. *BE/FE parallel after contract.*

**Edge cases & risks:** converting an unapproved quote → 409; converting the same quote twice → block or link (decide: one order per quote, 409 on second); status transition map is the single source — no ad-hoc transitions in UI; kanban drag race with auto-move events (last-write-wins is acceptable, stage is advisory); stage-age needs `stage entered_at` (pipeline_stages table already tracks — verify).

**Testing:** empirical green; tsc; demo approved-quote→order one click + kanban drag persists.

**Deployment:** routers registered; rides 01 schema. Rollback: unregister.

**Handoff:** orders + `order_repo` + transition map + Timeline tab (audit rendering). 05 attaches payments to `order_id`; 08 attaches production to `order_items`.

---

### Module 05 — Payments, schedules, reminders, receipts

> **PLAN MODE REQUIRED (money).** `security-reviewer` quick pass. Spec: `modules/05-payments.md`.

**Objective / done =** accounts records an advance → immutable receipt PDF generated → outstanding drops by exactly that amount; payments cannot be UPDATEd/DELETEd (RLS proves it); over-payment blocked unless admin override; refund kind requires admin; schedule rows flip pending→due→paid; `payment_due` reminders schedule without duplicates and bypass marketing-consent as utility (still require wa_id + not withdrawn).

**Prerequisites:** 04 (orders); schedule policy + receipt-to-customer + turnover<₹5cr answers (fallbacks available); `SEND_RECEIPTS_TO_CUSTOMER` default false.

**Technical scope & contract (`api/payments.py` + `payment_repo.py`):**
```
POST /api/payments            {order_id, kind, amount>0, mode, reference, paid_at}. Guards: amount>0;
                              over-payment (paid+amount>grand_total)→409 unless override flag (admin only);
                              refund→admin only (role verified in DB from caller salesperson id);
                              allocate RCP no; mark matching schedule paid; enqueue receipt PDF + optional WA. 201
POST /api/orders/{id}/schedule replace schedule rows [{label,due_date,amount}]; presets from config. 200
                              (NO PUT/DELETE on payments — ever)
```
`kind ∈ {advance,stage,final,refund}`, `mode ∈ {cash,upi,bank,cheque,card}`. **Receipt PDF:** `services/receipt_html.py` + reuse `tasks/pdf.py::render_receipt_pdf(payment_id)`→documents row. **Reminders:** new `tasks/payment_reminders.py` (beat **daily 10:00 IST**): schedules `due_date<=today+2 & status=pending`→set `due`→`followup_repo.schedule_followup` template `payment_due` vars {name,amount,order_no,due_date} (dedupe built-in); existing `send_due_followups` delivers. **Consent:** add `category` field to `FollowupTemplate`; utility-category templates bypass marketing-consent in `followup._skip_reason` (still require wa_id + not withdrawn). **Dashboard:** order detail Payments tab (immutable list, Record Payment modal, schedule editor, outstanding banner); `payments/page.tsx` accounts landing (today's collections, outstanding by order, aging buckets 0-7/8-30/30+ — SQL view `payment_aging`).

**Task breakdown:** (plan mode + review) → (0.5d) plan sign-off → (1.25d, BE) payment_repo + POST with all guards + RCP + schedule flip → (0.5d, BE) receipt_html + render task → (0.75d, BE) payment_reminders beat + FollowupTemplate.category + `_skip_reason` change → (0.75d, BE) `test_payments_empirical.py` (immutability: UPDATE fails under RLS; over-payment guard; schedule flip; reminder dedupe) → (1.0d, FE) payments tab + modal + accounts landing → (0.25d) sec-review + demo. *Money guards are BE-critical; FE parallel.*

**Edge cases & risks:** over-payment vs advance-then-final (guard is on running total vs grand_total); refund making outstanding negative (allowed — it's a reversal; view handles Σnon-refund−Σrefund); concurrent double-record of same payment (FOR UPDATE on order or idempotency key); reminder sent twice across beat ticks (dedupe in `schedule_followup`); utility bypass must NOT leak marketing (test that a marketing template still respects consent); receipt WA send gated off until client confirms.

**Testing:** empirical incl. immutability + aging; `security-reviewer` on payments router; demo record-advance→receipt→outstanding drop. **USER confirms schedule policy + receipt-to-customer + turnover<₹5cr before module closes.**

**Deployment:** beat schedule gains `payment_reminders` daily 10:00; celery include+redeploy. Rollback: disable beat entry; payments POST is additive.

**Handoff:** payments + outstanding view + receipt PDF + `FollowupTemplate.category` (12 reuses for utility bypass) + payment_reminders pattern (12's watchdog mirrors it). 06 locks RLS on money tables.

---

### Module 06 — Roles, RLS completion, admin screens

> **PLAN MODE REQUIRED (security). USER personally reviews the RLS matrix.** Spec: `modules/06-roles-rls-admin.md`. Migration **`0018_rls_phase2a.sql`** (+`app_settings`).

**Objective / done =** the full RLS matrix (spec table) is enforced and proven by ≥12 `test_rls.py` assertions (accounts can't UPDATE payments; sales blind to other sales' quotes; workshop role sees no money tables); login routes each role to its landing; admin can CRUD staff/products and edit settings; `app_settings` drives GST defaults/terms/validity/schedule presets with 60s API cache.

**Prerequisites:** 02–05 tables exist; staff list + roles (fallback: Darshil+Hemant); user available for matrix sign-off.

**Technical scope:**
- **Migration `0018`:** write RLS policies for quotations/items, orders/items, payments, payment_schedules, products, doc_series/documents per the matrix (own-customers via `customer_assignments` pattern; owner/admin all; accounts read+write-no-update on payments; workshop/delivery none on money). `app_settings(key text pk, value jsonb)`.
- **Tests:** extend `rls_support.py` (seeded users per role) + `test_rls.py` (≥12 assertions).
- **Dashboard:** role routing after login (sales→/dashboard, accounts→/dashboard/payments, owner/admin→/owner, workshop_manager→/workshop [2B placeholder], delivery→/dashboard/deliveries [2C placeholder = ready-orders list]); per-role nav + middleware guard per route group; `/owner/admin/**` (Staff list/add/deactivate; Products CRUD; Settings→app_settings; Templates registry read-only w/ manual Meta status).
- **API:** settings loader for `app_settings` (60s cache) where server-side needed.

**Task breakdown:** (plan mode) → (0.5d) matrix review + sign-off → (1.0d, BE) `0018` policies + app_settings + db-review → (1.0d, BE) rls_support + test_rls ≥12 assertions → (1.25d, FE) role routing + nav + middleware guards → (1.0d, FE) admin screens (staff/products/settings/templates) → (0.25d) sec-review. *RLS (BE) and admin UI (FE) parallelize.*

**Edge cases & risks:** RLS gaps are silent data leaks — the test suite IS the proof, not eyeballing; accounts write-but-not-update on payments (column/command-level policy); workshop money-blindness is only *fully* enforced in module 13 (view-based) — 06 sets `none` policies as the floor; middleware role gate must not lock out during role change (re-fetch role server-side); `app_settings` cache staleness (60s acceptable; document it).

**Testing:** full `test_rls.py` green on temp DB (auth stub + seeded roles); `security-reviewer` on public endpoints + payments + RLS diff; **USER reads matrix + signs off in STATE.md.**

**Deployment:** `0018` to staging→prod (with 0011–0017 batch at go-live). Rollback: RLS policies are additive/replaceable; keep prior policy text to restore.

**Handoff:** enforced RLS + role routing + admin/settings + `app_settings`. 07 hardens + ships. 2B (13) extends RLS for workshop money-blindness.

---

### Module 07 — 2A hardening: E2E, seed, UAT, reviews, go-live

> Spec: `modules/07-2a-hardening.md`. **Milestone + invoice gate.**

**Objective / done =** the money-path E2E spec is green locally; a seed script populates a demo dataset; code+security reviews of the whole 2A diff are closed (CRITICAL/HIGH fixed); UAT scripts exist per role and Topaz staff execute them; migrations `0011–0018` are live in prod; the first real quote goes out with Hemant present; STATE.md 01–07 = `verified`.

**Prerequisites:** 01–06 done; local stack runnable (`supabase start`+api+worker); Meta template status known (degrade ok); prod backup/PITR confirmed.

**Technical scope:**
- **E2E (`@playwright/test` in apps/dashboard):** one spec, money path — login(sales)→create customer→build quote(2 items+discount)→send(mock WA via flag/intercept)→open `/q/[token]`→approve→order auto-exists→login(accounts)→record advance→outstanding correct→receipt document row exists. `make e2e` runs against local stack.
- **Seed (`apps/api/scripts/seed_demo.py`):** 10 customers, 5 products, 6 quotes across statuses, 4 orders, payments/schedules; idempotent.
- **Reviews (this module only):** `code-reviewer` full 2A diff (01–06), empirical-verify top findings, fix CRITICAL/HIGH; `security-reviewer` public quote endpoints + payments + RLS + storage bucket policies (documents private, signed URLs only).
- **Docs:** `docs/phase2/UAT_2A.md` (scripted per role, checkbox, Gujarati-friendly), `TRAINING_2A.md` one-pager per role; refresh app READMEs if drifted.

**Task breakdown:** (1.0d) Playwright setup + money-path spec → (0.5d) seed script → (1.0d) reviews + fix findings → (0.75d) UAT+training docs → (0.75d, PAIR/OPS) go-live checklist execution → (CLIENT ~5 business days) UAT by staff.

**Go-live checklist (with USER):** staging→prod migration push (0011–0018) after backup/PITR; prod env vars (`SUPABASE_SERVICE_ROLE_KEY` on api if missing, `app_settings` rows, `WA_MEDIA_ENABLED`, Playwright/chromium in prod image); Meta template status (degrade to window-only ok); first real quote with Hemant.

**Edge cases & risks:** E2E flakiness (mock WA deterministically; quarantine flaky); prod migration on live data — the pipeline enum data-migration is the risky one (backup first, verify Phase 1 analytics still reads correctly post-migrate — §0.2); chromium in prod image size; UAT reveals scope gaps → triage into fix-now vs CR.

**Testing:** E2E green locally; reviewer findings closed; UAT executed by Topaz staff.

**Deployment & rollback:** this IS the 2A prod cutover. Rollback plan: DB restore from pre-push backup (enum data-migration is the only non-additive change); dashboard/api redeploy to prior commit; keep the migration down-map handy.

**Handoff to 2B:** verified 2A prod (orders live — the anchor 2B production attaches to); seed data for demos; UAT/training doc templates 2B mirrors; go-live checklist template. **Trigger 2A milestone invoice.**

---

## 4. PHASE 2B — "Make" (allocate → produce → track → notify)

**Phase objective:** confirmed orders are allocated to workshops; a workshop manager advances each order-item through 11 production stages from a phone-first PWA (Gujarati-first, ≤3 taps with photo); a live board reflects progress in real time; customers get capped, window-aware production updates; a daily watchdog surfaces stalls to the owner. Workshop roles are money-blind.

**Phase success criteria (verifiable):**
- E2E spec 2 green: allocate→PWA login→advance 3 stages w/ photo→board reflects live→customer message row created→block/unblock.
- Stage state machine proven: order-of-stages enforced, photo-required enforced, concurrent double-advance yields one event, order status auto-flips confirmed→in_production→ready.
- `test_rls.py` proves workshop manager can't select payments, can't see other workshops' items, can't see `grand_total`.
- PWA Lighthouse installable pass; a real manager completes a stage unaided after one training session (pilot success bar >80% same-day stage entry).
- Customer production messages capped ≤1/order/day; utility bypass respects withdrawn consent.
- STATE.md 08–13 = `verified`.

---

### Module 08 — Workshops, media, allocation (migrations 0023–0025)

> `database-reviewer` on migrations. Spec: `modules/08-workshops-media.md`.

**Objective / done =** `workshops`, production tables (`production_stage_defs` seeded 11 stages, `order_item_assignments`, `production_events`), and polymorphic `media` exist; `order_items` gains `current_stage`/`current_stage_at`/`workshop_id` (added HERE in `0020`, not in 2A's orders migration); allocation assigns an item to a workshop with one active assignment per item; media sign-upload→complete→thumbnail flow works locally.

**Prerequisites:** 2A live (orders + order_items); workshop list + Gujarati stage names (fallback: empty workshops, English + placeholder Gujarati); `media` bucket private (OPS).

**Technical scope:**
- **`0023_workshops`:** `workshops(id,name,type∈{own,vendor},manager_name,manager_phone,manager_salesperson_id fk,address,active)`; seed from client list or empty.
- **`0024_production`:** `production_stage_defs(code pk,sort unique,label_en,label_gu,photo_required,active)` seed 11 (design_approved…dispatch); `ALTER order_items ADD current_stage fk stage_defs, current_stage_at, workshop_id fk workshops`; `order_item_assignments` (partial unique index: one active per item); `production_events` (append-only, RLS no update/delete); **trigger** on event insert: `done`→advance `current_stage` to next by sort; first done on order→status `in_production`; all items past final→status `ready`. Trigger only maintains denorm; complex logic in API.
- **`0025_media`:** `media(id,entity_type∈{customer,order,order_item,production_event,delivery},entity_id,kind∈{reference,drawing,site,production,finished,delivery},storage_key,thumb_key,mime,bytes,created_by,created_at)` + index. Bucket `media` private, role-based RLS (staff read; authenticated staff write).
- **API:** `api/workshops.py` (CRUD admin, list); `api/media.py` (`POST /api/media/sign-upload`→{signed upload url, media id}; `POST /api/media/{id}/complete`→enqueue thumb); `api/production.py` (`POST /api/production/allocate`→deactivate prior, set order_items.workshop_id, audit); `tasks/media.py::make_thumb` (pillow, 400px).
- **Dashboard:** `production/allocate/page.tsx` (unallocated confirmed-order items queue + assign modal + per-workshop open-count); admin Workshops CRUD tab; shared `MediaGallery`+`MediaUpload` (dep `browser-image-compression`).

**Task breakdown:** (1.0d, BE) 3 migrations + trigger + db-review → (0.75d, BE) workshops + media APIs + make_thumb → (0.5d, BE) allocate endpoint + one-active-per-item → (0.75d, BE) `test_production_empirical.py` part1 (allocation uniqueness, media lifecycle) → (1.25d, FE) allocate page + admin workshops + Media components → (0.25d) demo upload→thumb.

**Edge cases & risks:** trigger complexity (keep it denorm-only; the "next stage by sort" + "all complete→ready" logic must handle multi-item orders — test with 2+ items); partial unique index for one-active-assignment (verify it rejects a second active); media polymorphic entity_type has no FK integrity (validate entity exists in API); thumbnail task failure leaves thumb_key null (gallery falls back to full/placeholder); Gujarati labels are placeholders until client confirms — labels are data (`label_gu`), hot-swappable, not code.

**Testing:** empirical green; migrations clean on temp DB; upload→thumb manual. **USER:** workshop list + Gujarati names; OPS submit 2B templates (production_started, production_completed image-header, ready_for_dispatch).

**Deployment:** `0023–0025` staging→prod (batch); `media` bucket + policies; celery include `tasks.media`. Rollback: additive schema; drop trigger to disable auto-advance if misbehaving.

**Handoff:** workshops + assignments + events + stage_defs + media + allocation + the trigger. 09 drives the state machine over these; 10/11 render them.

---

### Module 09 — Production state machine + events API

> Spec: `modules/09-production-engine.md`. Demo gate. **This module's empirical suite is its core deliverable.**

**Objective / done =** advancing an item inserts a `done` event for the current stage and the trigger moves `current_stage`; stage order is enforced (can't skip → 409); photo-required stages need `media_id` (else 409); only the assigned workshop's manager (or admin/owner) can advance; concurrent double-advance yields exactly one event; block/unblock works; admin override inserts loud audit rows for skipped stages; order status auto-flips verified.

**Prerequisites:** 08 (all production tables + trigger + allocation).

**Technical scope & contract (`api/production.py` extend + `production_repo.py`):**
```
POST /api/production/items/{order_item_id}/advance   {note?, media_id?} item must be allocated; insert done for
                                                     current stage; trigger advances. Guards: stage order (no skip→409),
                                                     photo_required needs media_id (409), actor = assigned mgr|admin|owner.
POST /api/production/items/{id}/block                {note required}. Blocked excluded from advance until unblock.
POST /api/production/items/{id}/unblock
POST /api/production/items/{id}/override-stage       admin only, reason required, audit loud (done rows for skipped
                                                     stages, note 'admin override').
GET  /api/production/my-queue                        workshop_manager scoped: assigned active items + stage + due + blocked.
```
Repo: `get_item_stage_state`, `insert_event` (**FOR UPDATE on order_item row** — concurrent double-tap protection, same as followup claim), `queue_for_workshop`. **Notifications stub:** create `tasks/production_notify.py::notify_stage_event(event_id)` with logger-only body + register include (12 implements).

**Task breakdown:** (1.0d, BE) advance + stage-order + photo guards + FOR UPDATE → (0.5d, BE) block/unblock + override + my-queue → (0.25d, BE) production_notify stub + include → (2.0d, BE) empirical suite (stage-order guard, photo enforcement, concurrent double-advance→one event, trigger progression, order status flips, blocked flow, override audit) → (0.25d) demo walk 11 stages via curl.

**Edge cases & risks:** concurrent double-tap from a flaky phone network is the real-world case — FOR UPDATE + idempotent insert is mandatory, and the empirical test must spawn two parallel advances; skip-stage attempt; advancing a blocked item (reject); advancing an unallocated item (409); override must be un-abusable (admin only + loud audit); last-stage done sets dispatch-complete not a phantom next stage; multi-item order status only →ready when ALL items complete.

**Testing:** full empirical suite (the deliverable); demo: allocate seeded order, walk all 11 stages, watch status flip.

**Deployment:** router extend + stub include; rides 08 schema. Rollback: unregister endpoints; trigger stays.

**Handoff:** stage API + `my-queue` (10 consumes) + event stream (11 subscribes) + notify stub (12 fills). 10 is the phone client for these endpoints.

---

### Module 10 — Workshop PWA (My Queue)

> Spec: `modules/10-workshop-pwa.md`. **THE adoption-critical module.** Field-test gate. Target: 45-yr-old manager, mid-range Android, low English literacy — every decision minimizes taps-to-done.

**Objective / done =** a workshop_manager logs in on a phone, sees only their assigned items as cards (finished-photo, item, order no, customer first name, BIG current stage in Gujarati-primary, due chip red if overdue, blocked banner), taps an item, and completes a stage in ≤3 taps with photo / 2 without; block with a note; language toggle persists; Lighthouse PWA installable passes; a real manager does it unaided in a field test.

**Prerequisites:** 09 (production endpoints incl. my-queue, advance, block); 2 real managers for field test (CLIENT); manager_salesperson_id links set (08 data).

**Technical scope:**
- **PWA shell:** `manifest.json` (name "Topaz Workshop", amber theme, generated SVG icon set); service worker (shell cache only, network-first data, **NO offline queue v1** — scope fence); route group `app/workshop/**`, middleware role gate (workshop_manager only, others redirected); reuse phone-OTP login.
- **Screens:** `workshop/page.tsx` My Queue (cards per spec); `workshop/items/[id]/page.tsx` stage stepper (done ✓ grey / current amber / future muted) + two primary buttons — **[✓ સ્ટેજ પૂર્ણ / Stage done]** (photo_required or opt-in → camera sheet `input capture=environment`→compress→signed upload→media id→confirm→advance→next renders) and **[અવરોધ / Blocked]** (note, voice-to-text hint); history accordion w/ thumbs.
- **i18n:** all strings in `workshop/i18n.ts` (en+gu), toggle persisted localStorage; Gujarati placeholders until client confirms.
- **Server actions (`workshop/actions.ts`):** `advanceStage(itemId, mediaId?)`, `blockItem(itemId, note)`, fetch queue — call FastAPI production endpoints with `DASHBOARD_API_KEY` + actor salesperson id from Supabase session, 10s AbortSignal. No API changes (09 endpoints).

**Task breakdown:** (0.75d, FE) PWA shell + manifest + SW + middleware gate → (1.0d, FE) My Queue screen + cards → (1.5d, FE) item stage stepper + CameraCapture + compress + upload → (0.75d, FE) i18n dict + toggle + server actions → (0.5d, FE) Lighthouse + polish → (CLIENT/PAIR) field test 2 managers, log to STATE.md.

**Edge cases & risks:** low-literacy UX is the make-or-break — Gujarati primary, big touch targets, icons over text, minimal typing (voice hint for block note); mid-range Android camera/compression perf (test on a real ₹10–15k phone, not a flagship); flaky network mid-upload (show progress, retry, don't lose the tap); no offline queue means a dead network blocks entry — acceptable v1, documented, watchdog catches gaps; field feedback WILL demand changes — one redesign loop is budgeted in module 11.

**Testing:** tsc; Lighthouse PWA installable; **manual full stage walk on a real Android by 2 real managers** — feedback to STATE.md.

**Deployment:** dashboard deploy (PWA served from same Vercel app). Rollback: route group behind role gate; disabling = revoke workshop_manager role routing.

**Handoff:** working phone client + **field feedback list** (11's first task) + CameraCapture + i18n pattern.

---

### Module 11 — Live production board + order tabs (+ PWA iteration)

> Spec: `modules/11-production-board.md`. Demo gate. **First task: apply module-10 field feedback (up to 2 days budgeted).**

**Objective / done =** module-10 field fixes applied; sales/owner/admin see a live board (columns per stage, cards=items with thumb/workshop/days-in-stage/blocked), cards move in real time (<2s) when the PWA advances a stage; order detail gains Production tab (per-item n/11 progress) and Photos tab (gallery by kind + multi-select share to customer, window-aware).

**Prerequisites:** 10 (PWA + feedback); 09 (event stream); Supabase Realtime on `production_events` (tiny migration `0022` if publication needed).

**Technical scope:**
- **PWA fixes** from STATE.md module-10 notes (≤2d).
- **Live board (`dashboard/production/page.tsx`):** columns per stage_defs sort; cards per spec; filters (workshop, overdue-only, order search); **Realtime** subscribe `production_events` INSERT (pattern `hooks/useVisitAlerts.ts` → new `hooks/useProductionEvents.ts`) → refetch/move affected card; card click → drawer (stage timeline + photos + assignment + block history).
- **Order detail additions:** Production tab (per-item progress bar n/11, current stage, workshop, due, blocked); Photos tab (`MediaGallery` grouped by kind, multi-select → "Share on WhatsApp" server action → send selected images to customer **only if 24h window open**, else toast "window closed — customer must message first"; v1 no image templates).
- **WA image send:** `send_wa_image` **already exists** in `tasks/whatsapp.py` — wire it. Decide share endpoint: new `POST /api/whatsapp/send-media` (dashboard-key) vs extend `/api/whatsapp/send`.

**Task breakdown:** (up to 2.0d, FE) PWA field fixes → (1.0d, FE) live board + useProductionEvents realtime → (0.5d, FE) drawer → (0.75d, FE) order Production+Photos tabs → (0.5d, BE) send-media endpoint (wire existing send_wa_image) → (0.25d) two-browser demo (<2s move).

**Edge cases & risks:** realtime reconnect/missed events (refetch on reconnect, don't rely solely on the stream); board perf with many items (paginate/virtualize columns); window-closed share is the common case — clear toast, no silent failure; image share respects consent; realtime publication migration must be idempotent.

**Testing:** tsc; manual two-browser (PWA advances → board card moves live <2s); demo to Hemant.

**Deployment:** realtime publication migration if needed; dashboard deploy. Rollback: disable realtime subscription (board falls back to manual refresh).

**Handoff:** live visibility + image share rail + realtime hook pattern. 12 sends notifications off the same events.

---

### Module 12 — Notifications + delay watchdog

> Spec: `modules/12-notifications-watchdog.md`. Demo gate.

**Objective / done =** `notify_stage_event` (stub from 09) is implemented — internal alerts (blocked→salesperson+owner immediately; quality_inspection/dispatch done→salesperson) and capped customer updates (first-stage→`production_started`, finishing→`production_completed` w/ image, dispatch/packing→`ready_for_dispatch`), max 1 customer production msg/order/day, utility bypasses marketing consent but respects withdrawn; a daily watchdog (08:30 IST) composes ONE owner digest (stale items 4+ days, past-due, plus orders/payments/quotes-awaiting counts) and nudges each manager with their stale items.

**Prerequisites:** 09 (events + stub); 11 for image send in `production_completed`; 2B templates approved (degrade to window-only otherwise); `FollowupTemplate.category` (from 05).

**Technical scope:**
- **`tasks/production_notify.py`:** implement per spec; extract pure `services/production_messaging.py` (stage→template mapping + cap logic) for unit testability; cap check = messages table last utility to customer today.
- **`tasks/production_watchdog.py::flag_delays`** (beat **daily 08:30 IST**): stale items (`current_stage_at < now()-STAGE_STALE_DAYS`, not blocked) + past-due items → ONE owner digest WhatsApp (counts + top 5, e.g. "3 items no update 4+ days: ORD-2627-0012 sofa @ Workshop B — polishing 6d") + one nudge/manager. Appends owner daily digest: orders confirmed today, payments received today (sum), quotes awaiting approval count — one message.
- Registry entries in `services/templates.py`; config knobs in `config.py`.

**Task breakdown:** (0.75d, BE) production_messaging pure fns + unit tests (cap, mapping) → (0.75d, BE) notify_stage_event impl + wire → (1.0d, BE) watchdog + owner digest + manager nudges + beat entry → (0.5d, BE) config knobs + registry → (0.5d) manual walk + cap verification + watchdog dry-run.

**Edge cases & risks:** cap logic must survive multiple events same day (query last utility today per order); withdrawn consent hard-respected even for utility; window-closed + template-pending → skip + log, never spam; watchdog digest must be ONE message not four (spec); timezone (beat is Asia/Kolkata — verify 08:30/10:00 fire at IST); owner WA number config not hardcoded.

**Testing:** unit green (cap + mapping pure fns); manual (walk stages → correct messages queued in messages table, cap enforced on 2nd same-day event, watchdog dry-run prints expected digest).

**Deployment:** beat gains `production_watchdog` 08:30; celery include + redeploy. Rollback: disable beat entries; notify stub returns to logger-only.

**Handoff:** full notification layer + watchdog. 13 hardens + pilots the whole 2B.

---

### Module 13 — 2B hardening: workshop RLS, E2E, pilot, rollout

> **PLAN MODE REQUIRED (RLS).** Spec: `modules/13-2b-hardening.md`. **Milestone + invoice gate.**

**Objective / done =** workshop_manager RLS is money-blind (SELECT limited to assigned items via a `workshop_items` view exposing safe columns only; cannot select payments/schedules/totals — proven by test_rls); E2E spec 2 green; 2B reviews closed; a 2-week pilot on 1 workshop meets the success bar (>80% stage events same-day, manager unaided after session 1); all workshops onboarded; RUNBOOK written; STATE.md 08–13 = `verified`.

**Prerequisites:** 08–12 verified; 1 pilot workshop + 2–3 live orders (CLIENT).

**Technical scope:**
- **RLS completion:** `workshop_items` view exposing safe columns (item specs, stage, workshop, due — NO money); RLS so workshop_manager SELECTs only assigned items and is blind to payments/schedules/quotation totals/grand_total; delivery role placeholder (ready-status orders read). Extend `test_rls.py`: workshop mgr can't select payments (0 rows/error), can't see other workshops' items, can't see grand_total.
- **E2E spec 2:** allocate→PWA login(workshop)→advance 3 stages w/ photo→board reflects→customer message row created→block/unblock.
- **Reviews:** `code-reviewer` full 2B diff (empirical-verify top findings); `security-reviewer` media signed URLs + workshop money-blindness + public surface re-check.
- **Pilot (USER-led, AI support):** 1 workshop, 2–3 orders, 2 weeks, daily fix loop (friction→same-day patch). Docs: `UAT_2B.md` + `TRAINING_2B.md` (Gujarati one-pager w/ screenshots).
- **Rollout + close:** all workshops onboarded; training session 2; `docs/phase2/RUNBOOK.md` (deploys, backups check, template management, common support fixes). Retro → seeds 2C scoping.

**Task breakdown:** (plan mode) → (1.0d, BE) workshop_items view + money-blind RLS + delivery placeholder → (0.75d, BE) test_rls extension → (1.0d) E2E spec 2 → (0.75d) reviews + fixes → (0.5d) UAT_2B/TRAINING_2B/RUNBOOK → (CLIENT ~2 weeks) pilot + daily patches → rollout + training 2.

**Edge cases & risks:** money-blindness via view is subtle — a naive join could re-expose totals; the RLS test is the proof, and the security review must specifically try to read `grand_total` as a workshop manager; pilot WILL surface friction (budget daily patches); rollout to vendor workshops (do vendors get logins? — client answer from 08); enum/schema changes during pilot must be backward-safe on live orders.

**Testing:** RLS suite + E2E green; reviewer findings closed; **pilot success bar met**; sign-off logged in STATE.md.

**Deployment & rollback:** RLS view to staging→prod; this is the 2B cutover + rollout. Rollback: restore prior RLS; PWA/board behind role gates. Pilot is inherently staged (1 workshop first).

**Handoff to 2C:** verified full 2B prod; RUNBOOK; pilot retro notes scoping delivery mgmt, reports pack, feedback/repeat nudges, search/calendar. **Trigger 2B milestone invoice.**

---

## 5. PHASE 2C — "Deliver & Optimize" (scope-only — REQUIRES a Change Request)

**Status: NOT in current SOW.** Referenced only in module 13's retro ("seeds 2C scoping"). Building any of this without a written Change Request (SOW §11, ₹8,000/day T&M) is a scope breach. This section is a scoping placeholder so the roadmap is complete, not a build plan.

**Candidate scope (from module 13 retro + CLAUDE.md delivery placeholder):**
- **Delivery management** — the `delivery` role placeholder becomes real: dispatch scheduling, delivery/installation proof photos (media `delivery` kind already modeled), e-way bill reminder for Gujarat city-to-city >₹50k (reminder only — not generation), delivery-status customer notifications.
- **Reports pack** — sales conversion funnel, workshop throughput/stage-time analytics, collections/aging exports, owner KPI dashboard beyond the current M6B analytics.
- **Feedback & repeat nudges** — post-delivery feedback capture; repeat-purchase cadence using the existing followup engine.
- **Search & calendar** — global search across customers/quotes/orders; delivery/appointment calendar.

**Before 2C can be planned to build-depth:** a signed Change Request defining scope + price; success criteria per feature; new data-model deltas; confirmation none of it crosses the standing scope fences (inventory/accounting/e-invoice/BOM/offline). Estimated planning effort once CR signed: ~2–3 days to expand this section to the module depth used for 2A/2B.

---

## 6. Consolidated risk register

Severity: **P0** blocks the phase · **P1** blocks a module · **P2** degrades quality/UX.

| ID | Risk | Sev | Modules | Trigger/symptom | Mitigation | Fallback |
|---|---|---|---|---|---|---|
| R1 | WhatsApp media send unverified + Meta Business Verification pending | **P0** | 03,08,11,12 | doc/image send fails; templates undeliverable outside 24h window | WA-MEDIA-SPIKE before 03; `WA_MEDIA_ENABLED` flag; push Meta verification (DEPLOYMENT Track C6) NOW in parallel | approval flow works without customer delivery; degrade to window-only; deliver docs via dashboard link |
| R2 | Migration number collision (0007–0010 already used) | **P0** | 01,06,08 | migration filename clash; prod push fails | §0.1 renumber to 0011+ as first pre-flight task | — (must fix before any build) |
| R3 | pipeline_stage rename breaks Phase 1 analytics (`'won'` query) | **P0** | 01,07 | est-pipeline analytics silently reads 0 after data-migration | grep + update all old-value reads in same PR (§0.2); verify on staging | keep `won` as retained value + alias in query layer |
| R4 | Prod migration on live data (enum data-migration non-additive) | P1 | 07,08,13 | data loss/incorrect stage mapping on live customers | backup/PITR before push; run on staging first; documented down-map | restore from backup; forward-fix |
| R5 | Money precision drift (float creep) | P1 | 01,02,05 | totals off by paisa; GST mismatch | Decimal-only, doc-level rounding, ≥20 goldens, grep gate for float in money paths | goldens catch pre-ship |
| R6 | Concurrent production double-advance from flaky phone net | P1 | 09,10 | duplicate stage events, wrong current_stage | FOR UPDATE on order_item + idempotent insert; empirical parallel-advance test | trigger denorm self-corrects; audit shows dupes |
| R7 | Workshop money-blindness leaks via view/join | P1 | 06,13 | manager can read grand_total/payments | view exposes safe columns only; test_rls asserts 0/err; security-review targets it | revoke view; column-level grants |
| R8 | PWA adoption failure (low-literacy manager can't/won't use it) | P1 | 10,11 | <80% same-day entry in pilot | Gujarati-first, icons, ≤3 taps, voice hint; field test 2 real managers; 1 redesign loop budgeted | paper→data-entry-clerk bridge during pilot; iterate |
| R9 | Client inputs late (GST/staff/workshop/Gujarati/terms) | P1 | 01,05,06,08 | module blocks on missing data | gather all during pre-flight; documented fallbacks; data-not-code (hot-swap) | ship with defaults, hot-swap on answer |
| R10 | Chromium/Playwright bloats prod image or OOMs on Railway | P2 | 03,05,07 | PDF task fails / image too big | documented RUN + boot check; task retry + size cap | WeasyPrint fallback (PLAN.md decision 4) |
| R11 | Meta template approval delay | P2 | 03,08,12 | templates pending at go-live | submit early (03/08), async; degrade to window-only | window-only sends; approve post-launch |
| R12 | Realtime board misses events on reconnect | P2 | 11 | card doesn't move live | refetch on reconnect; don't rely only on stream | manual refresh |
| R13 | Scope creep into fenced areas (inventory/accounting/e-invoice/BOM/offline) | P1 | all | task drifts out of SOW | flag on sight; raise CR | stop; Change Request |

---

## 7. Consolidated testing strategy

Per project rules: TDD (failing test first), 80%+ on the logic core, pure-core tests run without ML/network deps.

| Layer | What | Where | Gate in modules |
|---|---|---|---|
| Unit (pure, Decimal) | GST goldens (≥20), numbering FY, production stage→template mapping + cap logic | `tests/test_gst.py`, `test_numbering_empirical.py`, `services/production_messaging.py` tests | 01, 12 |
| Empirical DB harness | temp DB + `auth` stub + apply ALL migrations + run real repo fns | `test_*_empirical.py` (quotations, orders, payments, production) | 02, 04, 05, 08, 09 |
| RLS | seeded users per role, cross-role isolation assertions | `test_rls.py` + `rls_support.py` | 06 (≥12), 13 (workshop money-blindness) |
| Concurrency | parallel allocate_number; parallel production advance | empirical | 01, 09 |
| Immutability | payments UPDATE/DELETE fail under RLS | empirical | 05 |
| Type | `tsc --noEmit` clean | dashboard | 02, 04, 06, 10, 11 |
| E2E (Playwright) | 2A money path; 2B production path | `apps/dashboard`, `make e2e` local stack | 07, 13 |
| PWA | Lighthouse installable; real-device stage walk | manual | 10 |
| Reviews (agents) | `database-reviewer` per migration; `code-reviewer`+`security-reviewer` on milestone diffs | — | 01,08 (db); 07,13 (full+sec); 05 (sec) |
| Manual/UAT | scripted per-role UAT; pilot | `UAT_2A.md`, `UAT_2B.md` | 07 (UAT), 13 (pilot) |

**Gate rule (from SESSION_PROTOCOL):** a module is `done` when its named gates pass; `verified` only after gates green **and** user demo/UAT passes. Never advance a module with a red gate.

---

## 8. Consolidated deployment & rollout

**Migration discipline:** every migration → staging (verify) → prod (after backup/PITR + `database-reviewer`). User reviews diffs before any prod push. Batch the 2A schema (`0011–0018`) at the module-07 go-live; batch 2B schema (`0019–0022`) at module-08/13.

**Cutover points:**
- **2A go-live (module 07):** prod migrations 0011–0018; prod env vars (`app_settings` rows, `WA_MEDIA_ENABLED`, chromium in image); celery includes (`pdf`, `payment_reminders`) + beat (`payment_reminders` 10:00) → redeploy worker/beat; first real quote with Hemant.
- **2B go-live (module 08 + 13):** prod migrations 0019–0022; `media` bucket + policies; celery includes (`media`, `production_notify`, `production_watchdog`) + beat (`production_watchdog` 08:30) → redeploy; PWA served from existing Vercel app; **staged rollout** — 1 pilot workshop (module 13) before all.

**Feature flags:** `WA_MEDIA_ENABLED` (customer media delivery), `SEND_RECEIPTS_TO_CUSTOMER` (receipt WA), beat-schedule entries (disable a task without code change). Role routing gates the whole workshop PWA (disable = revoke role routing).

**Rollback playbook:**
- Additive migrations (most): unregister router / disable beat / redeploy prior commit.
- Non-additive (pipeline enum data-migration, RLS policy changes): DB restore from pre-push backup; keep documented down-map (`order_confirmed→won`, etc.) and prior RLS policy text.
- Celery: revert `include`/`beat_schedule`, redeploy worker+beat.
- Dashboard: Vercel instant rollback to prior deployment.

**Monitoring after each cutover:** Railway api/worker logs; `messages`/`payments`/`production_events` table sanity; template rejection watch; PITR/backups on (Supabase Pro).

---

## 9. Phase-boundary handoff summary

| Boundary | Phase N produces (artifacts + state) | Phase N+1 consumes |
|---|---|---|
| pre-flight → 01 | renumbered migration ledger; staging project; WA-MEDIA-SPIKE result; client inputs register filled | 01 builds on clean numbering + known GST config |
| 01 → 02–05 | frozen schema (0011–0017); `gst.compute_document`, `numbering.allocate` | all money features compute + number through these |
| 03 → 04 | approved-quote flow + `approval_token` + `documents` registry + `send_wa_document` + PDF task pattern | 04 order-from-quote; 05 receipt PDF reuse |
| 06 → 07 | enforced RLS matrix + role routing + `app_settings` | 07 hardens + ships; 13 extends RLS |
| **2A (07) → 2B (08)** | **verified 2A prod (orders live), seed data, UAT/training templates, go-live checklist, invoice** | 2B production attaches to `order_items`; mirrors UAT/training docs |
| 08 → 09 | workshops + assignments + events + stage_defs + media + allocation + auto-advance trigger | 09 drives state machine |
| 09 → 10 | stage API + `my-queue` + event stream + notify stub | 10 phone client; 11 subscribes events; 12 fills notify |
| 10 → 11 | working PWA + **field feedback list** + CameraCapture + i18n | 11's first task = apply feedback |
| 11 → 12 | live board + image-share rail + realtime hook | 12 notifies off same events |
| **2B (13) → 2C** | **verified 2B prod, RUNBOOK, pilot retro scoping notes, invoice** | 2C planning (after Change Request) |

---

## 10. Immediate next actions (this week)

1. **OPS/CLIENT:** create staging Supabase project; start/confirm Meta Business Verification; gather the client-inputs register (§2.6). *(unblocks everything)*
2. **BE:** pre-flight — apply §0.1 migration renumber patch to PLAN.md + module specs + STATE.md; run the §0.2 grep for old pipeline_stage reads. *(0.5–1d, no risk, docs+recon)*
3. **BE+OPS:** run WA-MEDIA-SPIKE (§0.3) — one real document + one real image to Darshil's phone; record in STATE.md. *(0.5d — decides R1 posture)*
4. **Then:** enter plan mode for **module 01** (per SESSION_PROTOCOL: modules 01/05/06/13 require plan mode + user review before build).

> **Note on companion docs:** applying §0.1/§0.2 means editing `PLAN.md`, `STATE.md`, and the module specs. This execution plan does not silently rewrite them — do that as the first tracked pre-flight commit so the change is reviewable.
