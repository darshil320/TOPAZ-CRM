-- Topaz CRM — 0041 · retire the single-order write path
--
-- ⚠️  DO NOT APPLY BEFORE THE API AND DASHBOARD DEPLOYS OF 0040 ARE LIVE.
--     Applying this while the previous dashboard is still serving makes scheduling a
--     delivery fail with:
--
--         function schedule_delivery(p_order_id => uuid, ...) does not exist
--
--     0040 is additive precisely so this file can wait. Check that
--     /dashboard/deliveries calls schedule_delivery(jsonb) in the deployed build first.
--
-- Two things go away, and both are a tightening:
--
--  1. **0039's SECURITY INVOKER schedule_delivery(uuid, …)** — it cannot express a
--     multi-order run at all (it raises 'Item % does not belong to this order'), so once
--     nothing calls it, leaving it callable leaves a second, weaker way to book a run.
--
--  2. **Direct INSERT on `deliveries` / `delivery_items` from the browser.** 0033 granted
--     it because the write had to come from the client. It no longer does:
--     schedule_delivery(jsonb) is SECURITY DEFINER and authorizes every order on the run
--     itself (0040 §3). Revoking the grant makes that function the ONLY way a delivery can
--     come into existence — one auditable place, instead of a policy that had to guess the
--     caller's intent from a header row whose items did not exist yet.
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists schedule_delivery(uuid, date, uuid, uuid[], text, text, text, text, numeric, text);
drop function if exists schedule_delivery(uuid, date, uuid, uuid[], text, text, text, text);
drop function if exists schedule_delivery(uuid, date, uuid, uuid[], text, text, text);

-- The policies go with the grant. Dropping the policy alone would leave the grant in place
-- (and a table with a grant and no INSERT policy is a confusing "permission denied" rather
-- than an honest one); dropping the grant alone would leave a dead policy to mislead the
-- next reader.
drop policy if exists deliveries_insert on deliveries;
drop policy if exists delivery_items_insert on delivery_items;

revoke insert on deliveries     from authenticated;
revoke insert on delivery_items from authenticated;

comment on table deliveries is
    'A lorry run. Created ONLY by schedule_delivery(jsonb) — no client INSERT grant exists '
    '(0041). Its items, and through them its orders and customers, live in delivery_items.';
