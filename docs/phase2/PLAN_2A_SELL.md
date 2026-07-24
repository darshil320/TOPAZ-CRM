# Phase 2A "Sell" — build / order / risk plan (M03 → M07)

**Status:** plan only, no code. **Authored:** 2026-07-24.
**Scope ceiling order (CLAUDE.md):** signed SOW › Quote › PRD v2 › master implementation plan › this doc.
**Companion:** [PLAN.md](PLAN.md) (locked decisions/GST facts), [STATE.md](STATE.md) (cross-session memory), [EXECUTION_PLAN_2A_2B.md](EXECUTION_PLAN_2A_2B.md), [modules/](modules/).

---

## 0. STOP — contract/scope gate (blocks M04 + M05 hard)

Every SOW on file **explicitly excludes orders + payments.**

- `../dmc-orchestrator/prospects/topaz-sow-v1.md` §4 — *"Phase 2 (separate SOW): Order management, Payment tracking, Workshop/production management…"* (named exclusions).
- `topaz-crm-sow-3L.md` §3 — *"❌ Order/payment/production/workshop/supplier/logistics modules."* — and this doc is **SUPERSEDED**.
- **Current signed CRM SOW = `topaz-crm-sow-1.5L.md`** (DMC-TPZ-CRM-2026-002, ₹1,50,000 + GST, "full system · single delivery"). Covers face-rec + CRM + visit history + salesperson alerts + WhatsApp follow-up + pipeline. Does **not** name quote / order / payment.
- **No signed Phase-2 "Sell/Make/Deliver" SOW exists in the repo.**

Contradiction: `EXECUTION_PLAN_2A_2B.md` cites `topaz-sow-v1` as "authoritative scope" — but that SOW *excludes* exactly what 2A builds.

Consequence (CLAUDE.md "flag, don't silently build" + SOW §11 Change Control):

| Module | Contract status | Verdict |
|---|---|---|
| M03 quote PDF/send/approval | quote-adjacent; not in Phase-1 §3, not in the exclusion list | grey — needs written OK |
| M04 orders | named exclusion (both SOWs) | out of scope — needs Phase-2 SOW / CR |
| M05 payments | named exclusion ("Payment tracking") | out of scope — needs Phase-2 SOW / CR |
| M06 roles/RLS/admin | cross-cutting; partly serves shipped Phase-1 | OK for RLS on existing tables; quote/order/payment admin gated by the above |
| M07 2A hardening | only meaningful if M03-05 authorized | gated by above |

DMC is the vendor. If a Phase-2 handshake with Hemant exists but is not papered — **paper it before M04/M05** (SOW §11 ₹8,000/day T&M; §12 defect-vs-new-feature). M01 + M02 already shipped sit in the same grey zone — flag, do not undo.

**M04/M05 are not treated as buildable until the contractual basis is confirmed.** The rest of this plan assumes that gate clears.

---

## 1. Build order + dependencies

```
M02 (done) ─┬─► M03 pdf/send/approval ──┐
            └─► M04 orders/pipeline ─────┼─► M05 payments ─┐
                                         │                 ▼
   WA-MEDIA-SPIKE ──► (unblocks M03 delivery)     M06 roles/RLS/admin
                                                         │
                                          M07 2A hardening ◄─┘ ─► go-live + invoice
```

Strictly sequential: M05 needs M04 (`payments.order_id`); M06 needs M02-05 tables; M07 needs all. M04 can start off M02 (auto-approve path wants M03 first).

---

## 2. Per-module

### M03 — quote PDF + WhatsApp send + public approval · ~5.5d · gate: demo
- **Scope:** Playwright→PDF (`services/pdf.py` new) + Jinja quote template (amber brand, items, GST block, amount-in-words, terms); Celery render→Supabase Storage `documents` bucket→`quotations.pdf_key`; `send_wa_document()` (thin reuse of existing `_upload_media_to_meta`); `POST /quotations/{id}/send` (24h-window-aware); public token routes `GET/POST /public/quotes/{token}` (approve/reject, idempotent, IP-stamped, no auth); dashboard public route `/q/[token]` (middleware must exclude it).
- **Deps:** M02, WA-MEDIA-SPIKE.
- **Gates:** PDF bytes >10KB; approve idempotency (double-POST = 1 audit); token 404 uniform; real doc to phone → approve → status + pipeline advance.
- **Open inputs:** quote terms text (fallback placeholder); Meta templates `quote_sent`/`quote_approved_confirm` submitted (OPS, async).
- **Risk:** media send unverified on live number; Meta Business Verification pending. Feature-flag `WA_MEDIA_ENABLED=false` → degrade to window-only; approval page ships regardless.

### M04 — orders + pipeline kanban · ~4.5d · gate: demo · ⚠ scope-gated (§0)
- **Scope:** `order_repo.py` + `orders.py`; `POST /orders/from-quote/{id}` (approved-only, copies header+items exactly, ORD number, `DEFAULT_ADVANCE_PCT=50`); manual order; `PATCH /status` guarded transition map (409 illegal, reason required on cancel); dashboard orders list (+`order_outstanding` view) + detail (tabs details/payments/timeline/docs) + kanban (9 stages, drag→`pipeline_stages`, stale >7d badge).
- **Deps:** M02 (M03 for auto-approve).
- **Gates:** conversion copies totals to the paisa; illegal transition 409; empirical green; tsc clean.

### M05 — payments, schedules, reminders, receipts · ~5.0d · plan-mode + security-review · ⚠ scope-gated (§0)
- **Scope:** `payment_repo.py` + `payments.py`; `POST /payments` (amount>0; over-payment 409 + admin override; refund admin-only, role verified server-side via DB); RCP numbering; schedule flip-to-paid; **no PUT/DELETE ever** (immutable; corrections = reversal rows); receipt PDF; daily reminder beat (`payment_due`, utility template bypasses marketing-consent but requires wa_id + not-withdrawn); accounts dashboard (collections, outstanding, aging 0-7/8-30/30+).
- **Deps:** M04.
- **Gates:** immutability proven under RLS (UPDATE fails); over-payment guard; reminder dedupe; security-reviewer pass.
- **Open inputs (CLIENT):** schedule policy (50/40/10?); receipts auto-sent? turnover <₹5cr confirmed. Fallbacks: `DEFAULT_ADVANCE_PCT=50`, `SEND_RECEIPTS_TO_CUSTOMER=false`.

### M06 — roles, RLS completion, admin screens · ~4.5d · plan-mode + security-review, USER signs RLS matrix
- **Scope:** migration `0018_rls_phase2a` (+`app_settings`); full RLS matrix (sales own-customers RW / accounts read + payments RW-no-update / workshop + delivery none on money / owner all); extend `test_rls.py` ≥12 assertions; role-based login routing + middleware guards; admin `/owner/admin/**` (staff, products CRUD, settings, template registry).
- **Deps:** M02-05 tables exist (RLS for M04/M05 tables meaningful only if authorized).
- **Open inputs (CLIENT):** staff list + roles + phones (fallback Darshil+Hemant only).

### M07 — 2A hardening: E2E, seed, UAT, go-live · ~4.0d + UAT · milestone + invoice
- **Scope:** Playwright money-path E2E (login→quote→send→approve→order→payment→outstanding); `seed_demo.py` (idempotent); code-reviewer + security-reviewer on full 01-06 diff; UAT + training docs (Gujarati-friendly); go-live checklist (staging→prod push 0011-0018 after backup/PITR, prod env vars, Meta templates).
- **Deps:** 01-06. **Gate:** E2E green, findings closed, UAT by Topaz staff, STATE.md 01-07 → verified.

---

## 3. Cross-cutting prerequisites (before M03)

1. **WA-MEDIA-SPIKE** (0.5d): one real doc + image to Darshil's phone via live number; confirm `statuses` webhook; record in STATE.md. Fail → M03 approval still ships; customer delivery flag-off.
2. **Staging Supabase project** — still not created (STATE.md); prerequisite before any hosted push. Prod head = 0010; migrations 0011-0018 built + local-verified, **not pushed**.
3. **Config knobs to add:** `DOCUMENTS_BUCKET`, `DEFAULT_ADVANCE_PCT`, `SEND_RECEIPTS_TO_CUSTOMER`, `WA_MEDIA_ENABLED`, `SUPABASE_SERVICE_ROLE_KEY` (api). No literals at decision points.

---

## 4. Top risks

| # | Risk | Mitigation |
|---|---|---|
| R0 | No signed Phase-2 SOW covers orders/payments | §0 gate — paper it / CR before M04-05 |
| R1 | WA media + Meta verification pending | spike + `WA_MEDIA_ENABLED` flag; window-only fallback |
| R2 | Pipeline reads remapped (`'won'`→`order_confirmed`) in M01 | verify M04 analytics reads use new vocabulary |
| R3 | Prod push of 0011-0018 destructive on live pipeline (0019 data-migration) | staging-first + backup/PITR, batched at M07 |
| R4 | GST inclusive/exclusive + HSN-per-family unanswered | goldens on documented fallback (exclusive/18%/9403); re-confirm before go-live |

---

## 5. Open client inputs (gather now, keep off critical path)

Quote terms text (M03) · schedule policy + receipt-send + turnover<₹5cr (M05) · staff list/roles/phones (M06) · GST inclusive-vs-exclusive + HSN family (M01 goldens final).

---

## 6. Recommended next action

1. **Resolve §0** — confirm contractual basis for orders/payments (signed Phase-2 SOW or CR).
2. In parallel: run WA-MEDIA-SPIKE + create staging project (both unblock everything; neither needs the scope answer).
3. If §0 clears → **M03 next**, single module, plan-mode entry (touches send + public endpoints), checkpoint after — same discipline as M02.
