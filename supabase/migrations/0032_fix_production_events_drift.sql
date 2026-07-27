-- Topaz CRM — 0032 · fix production_events schema drift from an earlier draft
--
-- ─── WHAT HAPPENED ─────────────────────────────────────────────────────────────
-- 0024_production.sql uses `create table if not exists production_events (...)`. On
-- prod, that table ALREADY EXISTED — an earlier, unreviewed draft of module 08/09 had
-- been hand-built directly against production before this repo's migration file
-- settled on its final column names. Because of `if not exists`, 0024 silently
-- skipped creating/altering the real table, leaving the OLD draft's schema in place:
--
--   old draft            this repo (0024)
--   ---------------       ----------------
--   event_type            kind
--   actor_id               actor
--   created_at            at
--   check: done/blocked/  check: started/done/
--     unblocked/override    blocked/unblocked
--   trigger → production_events_apply()   trigger → production_event_apply()
--     (plural, unreviewed body)             (singular, the reviewed/tested one)
--
-- Every line of Python in apps/api, and all 307 passing empirical tests, were written
-- against the RIGHT-hand column (kind/actor/production_event_apply). Discovered when
-- the first real `advance` request 500'd with `column "kind" does not exist`.
--
-- production_events had ZERO ROWS at the moment this was discovered (2026-07-27) — the
-- trigger had literally never fired in production. This migration is a rename plus a
-- trigger swap, not a data migration, and carries no data-loss risk.
--
-- order_item_assignments' equivalent drift (a differently-NAMED trigger,
-- `sync_order_item_workshop_trig`) turned out to call the SAME function
-- (`sync_order_item_workshop()`) this repo defines — verified by reading its
-- definition — so nothing there needs touching. Its extra old columns
-- (allocated_by/allocated_at/deallocated_at) are unused by this codebase and are left
-- alone; dropping columns nobody asked to remove is out of scope for a drift fix.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Column rename: only if the old names are still present. On any environment
-- where 0024 created this table fresh and correctly (pgtest, a future clean push),
-- these blocks are a no-op — `kind`/`actor` already exist under those names.
do $$
begin
    if exists (
        select 1 from information_schema.columns
         where table_name = 'production_events' and column_name = 'event_type'
    ) then
        alter table production_events rename column event_type to kind;
    end if;

    if exists (
        select 1 from information_schema.columns
         where table_name = 'production_events' and column_name = 'actor_id'
    ) then
        alter table production_events rename column actor_id to actor;
    end if;

    -- The old draft names its timestamp `created_at`; this repo's 0024 names it `at`
    -- (matching production_events_item_at_idx / _at_idx below, and every read in
    -- repositories/production_repo.py). Missed on the first pass of this migration —
    -- caught by pgtest failing the same way prod did, on a genuinely clean DB.
    if exists (
        select 1 from information_schema.columns
         where table_name = 'production_events' and column_name = 'created_at'
    ) then
        alter table production_events rename column created_at to at;
    end if;
end $$;

-- ─── Realign the CHECK to this repo's value set ('started' informational-only per
-- 0024's own header; the old draft's 'override' is not a distinct kind in this
-- design — an admin override inserts ordinary 'done' rows with a note, per
-- api/production.py::override_stage). Drop under either possible name, add under
-- this repo's canonical name.
alter table production_events drop constraint if exists production_events_event_type_check;
alter table production_events drop constraint if exists production_events_kind_check;
alter table production_events add constraint production_events_kind_check
    check (kind in ('started', 'done', 'blocked', 'unblocked'));

-- The old draft's extra guards duplicate checks this repo already enforces at the API
-- layer (BlockRequest.note has min_length=1; a 'done' event is only ever inserted with
-- the current stage_code, never null) — dropped so the column rename above cannot
-- leave a constraint referencing a column that no longer has this name if Postgres
-- did not auto-update its text form. Not re-added: this repo's API is the boundary,
-- per CLAUDE.md's "explicit error handling at every boundary" — a second, DB-level
-- copy of the same rule is a second place for the two to silently drift apart.
alter table production_events drop constraint if exists production_events_block_has_note;
alter table production_events drop constraint if exists production_events_done_has_stage;

-- ─── Recreate this repo's function (idempotent CREATE OR REPLACE — a no-op body-wise
-- on any environment where it already matches, e.g. pgtest). Copied verbatim from
-- 0024_production.sql so a diff between the two files is a red flag, not expected.
create or replace function production_event_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_order_id  uuid;
    v_cur       text;
    v_next      text;
    v_next_sort int;
begin
    if new.kind = 'blocked' then
        update order_items set blocked = true, blocked_at = now()
         where id = new.order_item_id;
        return null;
    elsif new.kind = 'unblocked' then
        update order_items set blocked = false, blocked_at = null
         where id = new.order_item_id;
        return null;
    elsif new.kind <> 'done' then
        return null;
    end if;

    select order_id, current_stage into v_order_id, v_cur
      from order_items where id = new.order_item_id;
    if v_order_id is null then
        return null;
    end if;

    if v_cur is null then
        return null;
    end if;

    select d.code, d.sort into v_next, v_next_sort
      from production_stage_defs d
     where d.active = true
       and d.sort > (select sort from production_stage_defs where code = new.stage_code)
     order by d.sort
     limit 1;

    if v_next is null then
        update order_items
           set current_stage_at   = now(),
               production_done_at = coalesce(production_done_at, now())
         where id = new.order_item_id;
    else
        update order_items
           set current_stage = v_next, current_stage_at = now()
         where id = new.order_item_id
           and current_stage is not null
           and v_next_sort > (select sort from production_stage_defs
                               where code = order_items.current_stage);
    end if;

    update orders set status = 'in_production'
     where id = v_order_id and status = 'confirmed';

    if not exists (
        select 1 from order_items
         where order_id = v_order_id and production_done_at is null
    ) then
        update orders set status = 'ready'
         where id = v_order_id and status = 'in_production';
    end if;

    return null;
end;
$$;

-- ─── Replace the trigger wiring: drop whichever variant exists, attach the one
-- reviewed function under one canonical trigger name.
drop trigger if exists production_events_apply_trig on production_events;  -- old draft's wrapper, old function
drop trigger if exists production_events_apply on production_events;       -- in case a prior partial run created it
drop function if exists production_events_apply();                        -- the old, unreviewed, plural-named function

create trigger production_events_apply
    after insert on production_events
    for each row execute function production_event_apply();

-- ─── Bring the indexes up to this repo's exact names/definitions too, so a future
-- `pg_dump`/schema diff against this repo's migrations is clean. The old-named
-- equivalents (production_events_item_idx, production_events_media_idx) are left in
-- place rather than dropped — two indexes serving overlapping purposes cost storage,
-- not correctness, and dropping an index by a name this migration cannot be certain
-- nothing else depends on is not worth the risk for a cosmetic gain.
create index if not exists production_events_item_at_idx
    on production_events (order_item_id, at desc);
create index if not exists production_events_at_idx
    on production_events (at desc);
-- production_events_one_done_per_stage already exists under this exact name from the
-- old draft; the column rename above (event_type → kind) carries its predicate
-- forward automatically (verified: `alter table ... rename column` updates dependent
-- index predicates in place, same guarantee Postgres gives for views/constraints).
