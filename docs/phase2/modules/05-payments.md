# 05 — Payments, schedules, reminders, receipts

PLAN MODE REQUIRED (money).

## API (api/payments.py + repositories/payment_repo.py — new)
- `POST /api/payments` — order_id, kind, amount, mode, reference, paid_at. Guards: amount>0; over-payment (paid+amount > grand_total) → 409 with override flag param (admin only); refund kind → admin role only (role passed from server action after Supabase auth check — server action includes caller salesperson id; FastAPI verifies role via DB). Allocates RCP number. Marks matching schedule paid if amount covers. Enqueue receipt PDF + optional WhatsApp receipt (config `SEND_RECEIPTS_TO_CUSTOMER=false` until client answers).
- `POST /api/orders/{id}/schedule` — replace schedule rows (label/due_date/amount list); template presets from config.
- No PUT/DELETE on payments. Ever.

## Receipt PDF
- services/receipt_html.py + reuse tasks/pdf.py: `render_receipt_pdf(payment_id)` → documents row.

## Reminders (rides existing followup engine)
- New beat task in `tasks/followup.py` or separate `tasks/payment_reminders.py` (choose separate; add to include + beat_schedule daily 10:00 IST): schedules where due_date <= today+2 and status pending → set status due → schedule followup row template `payment_due` vars {name, amount, order_no, due_date} via followup_repo.schedule_followup (dedupe built-in). Existing send_due_followups delivers it. Add `payment_due` to services/templates.py (utility).
- Consent note: payment_due is transactional/utility — send regardless of whatsapp_marketing BUT followup engine currently guards on marketing consent → add `category` field on followups? SIMPLER: extend followup_repo.get_followup_customer_context guard: templates registered as utility bypass marketing-consent check (still require wa_id, not withdrawn). Implement as `FOLLOWUP_TEMPLATES[x].category` check in _skip_reason.

## Dashboard
- Order detail Payments tab: recorded list (immutable), Record Payment modal, schedule editor, outstanding banner.
- `dashboard/payments/page.tsx` (accounts landing): today's collections, outstanding by order, aging buckets 0-7/8-30/30+ (SQL view `payment_aging` — add tiny migration 0012b or compute in query).

## Files to touch
- apps/api/src/api/payments.py, repositories/payment_repo.py, services/receipt_html.py, tasks/payment_reminders.py (new); tasks/celery_app.py (include + beat); services/templates.py (+category field on FollowupTemplate + payment_due); tasks/followup.py (_skip_reason category-aware)
- apps/dashboard/src/app/dashboard/payments/**, orders/[id] payments tab
- tests: test_payments_empirical.py (immutability — UPDATE fails under RLS; over-payment guard; schedule→paid flip; reminder scheduling dedupe), test_gst untouched-green

## Gates
- Empirical green incl. immutability. security-reviewer agent quick pass on payments router. Demo: record advance → receipt PDF → outstanding drops.
- USER: confirm schedule policy + receipt-to-customer + turnover<₹5cr before this module closes.
