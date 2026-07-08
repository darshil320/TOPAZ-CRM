# 01 — Foundation: migrations 0007–0013, numbering, GST engine

PLAN MODE REQUIRED. database-reviewer agent on each migration before push.

## Migrations (supabase/migrations/)

**0007_roles.sql**
- `ALTER TABLE salespersons DROP CONSTRAINT` role check → new CHECK `('salesperson','owner','admin','accounts','workshop_manager','delivery')`
- Helper: `create function is_role(roles text[]) returns boolean` — true if current_salesperson_id()'s role = any(roles). SECURITY DEFINER, stable, mirrors 0004 style.

**0008_doc_series.sql**
- `doc_series(series text, fiscal_year text, last_no int not null default 0, primary key(series, fiscal_year))`
- `create function allocate_number(p_series text, p_fy text) returns int` — `INSERT ... ON CONFLICT DO UPDATE SET last_no = doc_series.last_no + 1 RETURNING last_no`. Atomic, no gaps-free guarantee needed beyond uniqueness.
- FY format helper: fiscal year Apr–Mar, e.g. '2627'. Compute in Python service, not SQL.

**0009_products.sql**
- `products(id uuid pk, name text not null, category text, hsn text not null default '9403', gst_rate numeric(4,2) not null default 18.00, base_price numeric(12,2), unit text default 'nos', active bool default true, created_at, updated_at)`

**0010_quotations.sql**
- `quotations(id, quote_no text unique not null, customer_id fk customers not null, status text check ('draft','sent','viewed','approved','rejected','expired') default 'draft', revision_of uuid fk quotations, revision_no int default 1, valid_until date, place_of_supply text default 'GJ', subtotal/discount_amount/taxable_value/cgst/sgst/igst/grand_total numeric(12,2), terms text, notes text, approval_token uuid unique default gen_random_uuid(), approved_at timestamptz, approved_ip text, pdf_key text, created_by fk salespersons, created_at, updated_at)`
- `quotation_items(id, quotation_id fk cascade, product_id fk nullable, description text not null, dimensions text, material text, fabric text, polish text, customization text, qty numeric(10,2) not null, unit text, unit_price numeric(12,2) not null, hsn text not null, gst_rate numeric(4,2) not null, line_total numeric(12,2) not null, sort int)`
- Rule: revision = NEW quotations row with revision_of set; old row frozen (status stays as-was, UI shows chain).
- RLS: sales sees quotes of their assigned customers (reuse customer_assignments pattern); owner/admin all; accounts read-only.
- Audit trigger on status changes.

**0011_orders.sql**
- `orders(id, order_no unique, customer_id fk, quotation_id fk nullable, status check ('confirmed','in_production','ready','delivered','installed','closed','cancelled') default 'confirmed', expected_delivery_date date, advance_expected numeric(12,2), subtotal/discount_amount/taxable_value/cgst/sgst/igst/grand_total numeric(12,2), salesperson_id fk, notes, created_at, updated_at)`
- `order_items(...)` mirrors quotation_items + `current_stage text` (null until 2B), `current_stage_at timestamptz`, `workshop_id uuid` (fk added in 0014 — leave column out here; ADD in 0015). Actually: omit workshop/stage cols here; 0015 adds them. Keep 0011 pure 2A.
- RLS like quotations. Audit trigger.

**0012_payments.sql**
- `payments(id, receipt_no unique, order_id fk not null, customer_id fk not null, kind check ('advance','stage','final','refund'), amount numeric(12,2) check (amount > 0), mode check ('cash','upi','bank','cheque','card'), reference text, paid_at timestamptz not null, recorded_by fk salespersons, notes, created_at)` — NO updated_at: immutable (revoke UPDATE via RLS; corrections = refund/reversal rows).
- `payment_schedules(id, order_id fk, label text, due_date date not null, amount numeric(12,2), status check ('pending','due','paid','waived') default 'pending', created_at, updated_at)`
- View `order_outstanding`: order_id, grand_total, paid (Σ non-refund − Σ refund), outstanding.
- RLS: accounts + owner/admin full; sales read own customers' payments.

**0013_pipeline_documents.sql**
- pipeline_stage enum: ADD VALUES 'inquiry','contacted','visit_scheduled','walk_in','design_discussion','quotation_sent','negotiation','order_confirmed' (postgres: ALTER TYPE ... ADD VALUE; cannot run in transaction — separate statements). Keep old values valid; data migration UPDATE mapping new→inquiry, talking→design_discussion, follow_up→negotiation, won→order_confirmed (lost stays).
- `documents(id, kind check ('quotation_pdf','receipt_pdf','invoice_pdf'), entity_type text, entity_id uuid, storage_key text not null, version int default 1, created_at)`

## Python services (apps/api/src/services/)

**gst.py** — pure functions, Decimal only:
- `compute_line(qty, unit_price, gst_rate) -> LineTax`
- `compute_document(lines, discount, place_of_supply, home_state='GJ') -> DocTotals` — discount pro-rated pre-tax; intra-state splits CGST/SGST = rate/2 each; inter IGST; round half-up 2dp per tax at document level.
- Golden tests `tests/test_gst.py` ≥20 cases: single line 18%; mixed 18/5; discount pro-rating; rounding edges (e.g. ₹999.995); inter-state; zero-rate line; qty decimals.

**numbering.py** — `allocate(session, series) -> str` calls SQL allocate_number with computed FY; formats `f"{series}-{fy}-{n:04d}"`.

## Files to touch
- supabase/migrations/0007..0013 (new)
- apps/api/src/services/gst.py, numbering.py (new)
- apps/api/tests/test_gst.py, test_numbering_empirical.py (new; empirical harness for allocate_number concurrency: two concurrent allocations, no dup)
- apps/api/src/config.py — add `HOME_STATE='GJ'`, `QUOTE_VALIDITY_DAYS=15`

## Gates
- test_gst.py green; empirical: migrations apply clean on temp DB, allocate_number concurrent-safe, quotations+items insert/select via psql smoke.
- database-reviewer agent per migration. User reviews diffs before any `db push`.
