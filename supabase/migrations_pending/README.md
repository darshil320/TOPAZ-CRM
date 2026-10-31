# `migrations_pending/` — migrations that must NOT be pushed yet

These are finished, reviewed migrations whose **safety depends on an application deploy
having happened first**. They are deliberately outside `supabase/migrations/` for one
reason: `supabase db push` applies every unapplied file in that directory, and this repo's
migration head routinely runs ahead of prod (see `docs/DEPLOYMENT.md`). A destructive
migration sitting in the auto-pushed directory is a foot-gun waiting for the next push —
it would drop a column the deployed code still reads.

`apps/api/scripts/pgtest.sh` also applies everything in `supabase/migrations/`, so keeping
these here means the empirical suite keeps proving the **current** schema, including the
deliberate backward-compatibility bridges (`deliveries.order_id` still derived,
`delivery_items.received` defaulting to true) that exist only until these files run.

## How to promote one

1. Confirm its gate below is satisfied — in the **deployed** build, not just in `main`.
2. `git mv supabase/migrations_pending/00NN_*.sql supabase/migrations/`
3. Update the affected tests in the same commit (a promoted migration usually invalidates
   a bridge test — that is the point).
4. `apps/api/scripts/pgtest.sh` must be green before the push.
5. Push, then record it in `docs/DEPLOYMENT.md`.

## Current contents

`0041` was promoted on 2026-10-25 (its gate — the dashboard calling
`schedule_delivery(jsonb)` — had been live since the 0040 rollout) and applied to prod.
0042's soak clock starts there: hold it for at least one more release.

| File | Gate — do not promote until |
|---|---|
| `0054_products_price_columns_staff_only.sql` | The dashboard build that reads prices from the `product_prices` view (0053 rollout: quote builder + Products pages) is **live on Vercel** and `rg -n 'base_price\|gst_rate' apps/dashboard/src --glob '!**/types.ts'` shows no `.from("products")` select of them. Revokes SELECT on `products.base_price/gst_rate/hsn` from browser JWTs so workshop/delivery roles cannot read prices straight from PostgREST. Reversible (re-grant). `test_rls_products_0053.py` already proves it inside a rolled-back transaction. |
| `0042_drop_deliveries_order_id.sql` | 0041 has soaked for a release **and** `rg -n 'deliveries\.order_id' apps/` is clean. Irreversible: drops `deliveries.order_id` and the four challan columns that moved to `delivery_consignments` in 0040. |

`0042` belongs to the 0040 multi-order-delivery rollout; see that migration's header for the
full four-phase sequence. `0054` is the last step of the 0053 QR-product-tag rollout
(`docs/DEPLOYMENT.md`).
