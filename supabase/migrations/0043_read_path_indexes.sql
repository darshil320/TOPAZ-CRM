-- Topaz CRM — 0043 · read-path indexes for the dashboard's list and detail pages
--
-- Pure performance: no schema, no policy, no data change. Every statement is
-- `if not exists`, so re-running is a no-op.
--
-- NUMBERING NOTE: 0041/0042 are deliberately held in `supabase/migrations_pending/`
-- (see that directory's README), so this file lands ahead of them. Promoting those two
-- later is an out-of-order push by design — already the accepted condition of that
-- rollout — and nothing here touches what they change.
--
-- Each index below backs a query the dashboard runs on EVERY page view. Written from
-- the actual read paths, not speculatively:
--
--   orders / quotations list        → order by created_at desc, limit/offset
--   order + quote detail timeline   → audit_log by (entity, entity_id), newest first
--   order detail payments           → payments of one order, newest first
--   the list search box             → ilike '%term%' across names, phones, numbers
--   line photos + photo galleries   → ready media for a set of entity ids
--
-- ─── Trigram search ──────────────────────────────────────────────────────────
-- `ilike '%term%'` can never use a btree index: the leading wildcard means there is
-- no prefix to descend on, so every list search was a sequential scan of customers
-- (plus one of orders or quotations). pg_trgm's GIN index is the fix, and it covers
-- the infix match the search actually does — see apps/dashboard/src/lib/listSearch.ts.
create extension if not exists pg_trgm;

create index if not exists customers_name_trgm_idx
    on customers using gin (name gin_trgm_ops);
create index if not exists customers_phone_trgm_idx
    on customers using gin (phone gin_trgm_ops);
-- wa_id is searched by the same helper (a customer is often found by the number they
-- messaged from, which is not always the number on their record).
create index if not exists customers_wa_id_trgm_idx
    on customers using gin (wa_id gin_trgm_ops);
create index if not exists orders_order_no_trgm_idx
    on orders using gin (order_no gin_trgm_ops);
create index if not exists quotations_quote_no_trgm_idx
    on quotations using gin (quote_no gin_trgm_ops);

-- ─── List ordering ───────────────────────────────────────────────────────────
-- Both lists are `order by created_at desc` + range(). Without these, every page of
-- every list sorts the whole table to return 25 rows — including page 1.
create index if not exists orders_created_idx    on orders (created_at desc);
create index if not exists quotations_created_idx on quotations (created_at desc);

-- The dispatch board and the order page both read runs newest-scheduled-first.
create index if not exists deliveries_scheduled_idx on deliveries (scheduled_date desc);

-- ─── Detail pages ────────────────────────────────────────────────────────────
-- audit_log had NO index of any kind. It is append-only and never pruned, so the
-- "Order Timeline" card's `where entity = 'orders' and entity_id = $1 order by
-- changed_at desc limit 20` was a full scan of a table that only ever grows — the
-- one query on that page guaranteed to get slower every week.
create index if not exists audit_log_entity_changed_idx
    on audit_log (entity, entity_id, changed_at desc);

-- Payment history for one order, newest first (payments_order_idx alone leaves the
-- sort to be done every time).
create index if not exists payments_order_paid_idx on payments (order_id, paid_at desc);

-- Line items are always read for one order in `sort` order.
create index if not exists order_items_order_sort_idx on order_items (order_id, sort);

-- ─── Media ───────────────────────────────────────────────────────────────────
-- Every photo read filters on `status = 'ready'` as well as the entity, and the
-- existing media_entity_idx (0025) does not. Partial, so it stays small: pending and
-- failed rows are GC targets, never rendered.
create index if not exists media_entity_ready_idx
    on media (entity_type, entity_id, created_at desc)
    where status = 'ready';

comment on index media_entity_ready_idx is
    'Line-item photos + production galleries: ready media for a set of entity ids.';
