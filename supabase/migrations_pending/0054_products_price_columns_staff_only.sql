-- Topaz CRM — 0054 · price/GST/HSN columns readable only through product_prices
--
-- GATE: do NOT promote until the dashboard build that reads prices from the
-- `product_prices` view (0053) is LIVE. Before that build, the quote builder and the
-- admin catalog select products.base_price directly and would fail with
-- "permission denied for column base_price".
--
-- Why: 0013 lets every authenticated user read every products column, so a
-- workshop_manager — possibly an outside vendor workshop's manager — or a delivery
-- driver could read the price list with their own JWT straight from PostgREST. 0053
-- made product_prices (gated by can_view_prices()) the sanctioned path; this takes
-- the direct one away. RLS cannot hide a column, so this is a column-level grant:
-- SELECT on the table goes, SELECT on every non-price column comes back.
--
-- Writes are untouched (INSERT/UPDATE/DELETE stay table-level and RLS-gated, 0013 /
-- 0052). product_prices keeps working because it runs with the owner's rights.
-- The API is unaffected — it is not `authenticated`.
--
-- ADDING A COLUMN TO products AFTER THIS: it is NOT readable by the browser until it
-- is added to the grant below in a new migration. That is the safe default for this
-- table — a new money column must not leak by omission.
-- ════════════════════════════════════════════════════════════════════════════

revoke select on products from authenticated;
grant select (
    id, name, category, unit, active, created_at, updated_at, primary_media_id,
    description, sizes, dimensions, material, finish, stock_status, qr_code
) on products to authenticated;
