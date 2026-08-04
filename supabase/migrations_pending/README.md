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

| File | Gate — do not promote until |
|---|---|
| `0041_deliveries_single_order_write_path_retire.sql` | The dashboard build calling `schedule_delivery(jsonb)` is **live**. Promoting early breaks scheduling with *function schedule_delivery(p_order_id => uuid, …) does not exist*. |
| `0042_drop_deliveries_order_id.sql` | 0041 has soaked for a release **and** `rg -n 'deliveries\.order_id' apps/` is clean. Irreversible: drops `deliveries.order_id` and the four challan columns that moved to `delivery_consignments` in 0040. |

Both belong to the 0040 multi-order-delivery rollout; see that migration's header for the
full four-phase sequence.
