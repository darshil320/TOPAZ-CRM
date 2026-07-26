-- Topaz CRM — 0024 · production stages, allocation, event stream (Phase 2B)
-- The production engine's storage layer: the 11 stage definitions, the per-item
-- workshop assignment (exactly one active), the append-only event stream, and the
-- denormalisation trigger that keeps order_items/orders in sync with the stream.
--
-- ─── TRIGGER SCOPE FENCE (CLAUDE.md: "trigger only maintains denorm") ──────────
-- production_event_apply() may ONLY:
--   (a) advance order_items.current_stage / current_stage_at
--   (b) set order_items.production_done_at when the last stage completes
--   (c) maintain order_items.blocked / blocked_at
--   (d) flip orders.status confirmed → in_production → ready (status-GUARDED)
-- It may NOT: validate stage order, enforce photo_required, authorize the actor,
-- refuse a blocked item, INITIALISE current_stage, write override audit rows, or
-- enqueue notifications. All of that is module 09's API layer. Because it may not
-- initialise, a `done` event on an item whose current_stage is NULL (never
-- allocated) is a NO-OP here, not an implicit production start.
-- A second trigger, sync_order_item_workshop(), keeps order_items.workshop_id equal
-- to the active order_item_assignments row — also pure denorm.
-- Rollback of auto-advance = `drop trigger production_events_apply on production_events`;
-- everything else in this migration is additive.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Stage definitions ───────────────────────────────────────────────────────
-- Codes are contractually fixed (PRD); LABELS ARE DATA, not code. Nothing in the
-- application reads label_gu except as a display string, so the client's confirmed
-- Gujarati wording is a one-UPDATE swap (scripts/update_stage_labels.sql), never a
-- migration. photo_required likewise: the pilot retunes it with an UPDATE.
create table if not exists production_stage_defs (
    code           text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
    sort           int  not null unique,
    label_en       text not null,
    label_gu       text,
    photo_required boolean not null default false,
    active         boolean not null default true
);

-- sort in tens so a client-requested intermediate stage slots in without renumbering.
--
-- photo_required = 4 stages, rationale (the specs do not make this call — module 08 does):
--   frame_work        — the structure disappears under upholstery; the only chance
--                       to evidence "was it built right".
--   finishing         — HARD DEPENDENCY: module 12 sends `production_completed` with
--                       an IMAGE header. No guaranteed photo here ⇒ that template
--                       degrades to text on a random subset of orders.
--   quality_inspection— a QC pass with no evidence is a checkbox, not an inspection.
--   dispatch          — condition-on-leaving proof; the only defence in a
--                       transit-damage argument.
-- Deliberately NOT required: upholstery (fabric disputes are real, but module 10's
-- whole thesis is <=3 taps — opt-in upload still works), and every stage with no
-- visually distinct artefact or redundant with a neighbour.
insert into production_stage_defs (sort, code, label_en, label_gu, photo_required) values
    ( 10, 'design_approved',      'Design approved',    'ડિઝાઇન મંજૂર',   false),
    ( 20, 'material_procurement', 'Material procurement','સામગ્રી ખરીદી',  false),
    ( 30, 'cutting',              'Cutting',            'કટિંગ',          false),
    ( 40, 'frame_work',           'Frame work',         'ફ્રેમ કામ',       true),
    ( 50, 'assembly',             'Assembly',           'એસેમ્બલી',        false),
    ( 60, 'upholstery',           'Upholstery',         'અપહોલ્સ્ટરી',      false),
    ( 70, 'polishing',            'Polishing',          'પોલિશિંગ',        false),
    ( 80, 'finishing',            'Finishing',          'ફિનિશિંગ',        true),
    ( 90, 'quality_inspection',   'Quality inspection', 'ગુણવત્તા તપાસ',   true),
    (100, 'packing',              'Packing',            'પેકિંગ',          false),
    (110, 'dispatch',             'Dispatch',           'ડિસ્પેચ',         true)
on conflict (code) do nothing;   -- never clobber a client-confirmed label on re-run

alter table production_stage_defs enable row level security;
-- Owner/admin write so a Gujarati typo is fixed in the admin tab, not a migration.
-- No DELETE grant: a stage referenced by order_items.current_stage or
-- production_events.stage_code must be DEACTIVATED (active = false); the trigger
-- skips inactive stages when computing "next".
grant select, insert, update on production_stage_defs to authenticated;

create policy stage_defs_select on production_stage_defs for select to authenticated
    using (true);
create policy stage_defs_write on production_stage_defs for all to authenticated
    using (is_owner() or is_role(array['admin']))
    with check (is_owner() or is_role(array['admin']));

-- ─── order_items production columns ──────────────────────────────────────────
-- Added HERE, not in 0015, so the 2A orders migration stays pure 2A (0015 header).
--
-- current_stage semantics (resolves the spec's own contradiction,
-- modules/08-workshops-media.md lines 15 vs 16):
--   NULL              = not allocated / production not started. The honest state:
--                       an unallocated item must not appear on the board in
--                       design_approved with no workshop, and module 12's stale
--                       watchdog must not count days against nobody.
--   <code>            = the stage the item is currently IN (work pending).
--   Initialised by the ALLOCATE API, never by the trigger — picking a starting
--   stage is a business decision, not an event consequence.
--
-- production_done_at replaces the spec's "current_stage='dispatch' complete flag",
-- which cannot distinguish "at dispatch, working" from "dispatched". On the last
-- stage's `done`, current_stage STAYS 'dispatch' and this timestamp is set. It is
-- also what makes "all items complete" a cheap NOT EXISTS.
alter table order_items
    add column if not exists current_stage      text references production_stage_defs(code),
    add column if not exists current_stage_at   timestamptz,
    add column if not exists workshop_id        uuid references workshops(id),
    add column if not exists blocked            boolean not null default false,
    add column if not exists blocked_at         timestamptz,
    add column if not exists production_done_at timestamptz;

-- 09 my-queue + 11 board columns: a workshop's items grouped by stage.
create index if not exists order_items_workshop_stage_idx
    on order_items (workshop_id, current_stage) where workshop_id is not null;

-- 08 allocate page: the unallocated-items queue (joined to orders.status='confirmed').
create index if not exists order_items_unallocated_idx
    on order_items (order_id) where workshop_id is null;

-- 12 watchdog: stale items (current_stage_at older than STAGE_STALE_DAYS).
create index if not exists order_items_stale_idx
    on order_items (current_stage_at)
    where workshop_id is not null and production_done_at is null and blocked = false;

-- NOTE — no new RLS on order_items in 08, deliberately. oi_select (0015:77) does
-- NOT include workshop_manager and MUST NOT: order_items carries unit_price,
-- line_total and gst_rate. That exclusion is exactly what forces module 13's
-- money-blind workshop_items view to be a manager's only path to production data.
-- The PWA reads production state through module 09's API (service role, money-blind
-- projection), never through Supabase directly.

-- ─── Allocation ──────────────────────────────────────────────────────────────
create table if not exists order_item_assignments (
    id             uuid primary key default gen_random_uuid(),
    order_item_id  uuid not null references order_items(id) on delete cascade,
    workshop_id    uuid not null references workshops(id),
    due_date       date,
    assigned_by    uuid references salespersons(id),
    active         boolean not null default true,
    created_at     timestamptz not null default now(),
    deactivated_at timestamptz
);

-- EXACTLY one active assignment per item. Mirrors one_active_primary_per_customer
-- (0002) and is the DB backstop behind the allocate transaction's FOR UPDATE.
create unique index if not exists order_item_assignments_one_active
    on order_item_assignments (order_item_id) where active = true;

-- Full reallocation history for one item (the drawer's assignment timeline). The
-- partial unique index above only covers the active row, so this FK needs its own.
create index if not exists order_item_assignments_item_idx
    on order_item_assignments (order_item_id);

-- 08 per-workshop open-count hint; 09 queue_for_workshop; 13 workshop_items view.
create index if not exists order_item_assignments_workshop_idx
    on order_item_assignments (workshop_id) where active = true;

-- ─── order_items.workshop_id is a DENORM of the active assignment ────────────
-- Two writable copies of "which workshop holds this item" would drift, and the
-- drift is load-bearing: pe_select (below) scopes a workshop manager's REALTIME
-- event stream off order_items.workshop_id, and the allocate queue's
-- order_items_unallocated_idx keys off it being NULL. So the DB owns the sync
-- rather than trusting every present and future caller to write both.
-- Recomputed from scratch each time (not copied from NEW) so deactivate-without-
-- reallocate correctly clears it back to NULL.
create or replace function sync_order_item_workshop()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_item uuid := coalesce(new.order_item_id, old.order_item_id);
begin
    update order_items
       set workshop_id = (select a.workshop_id from order_item_assignments a
                           where a.order_item_id = v_item and a.active = true)
     where id = v_item;
    return null;
end;
$$;

create trigger order_item_assignments_sync_denorm
    after insert or update or delete on order_item_assignments
    for each row execute function sync_order_item_workshop();

-- 12 watchdog past-due scan (mirrors payment_schedules_due_idx, 0016).
create index if not exists order_item_assignments_due_idx
    on order_item_assignments (due_date) where active = true and due_date is not null;

-- ─── Event stream (append-only) ──────────────────────────────────────────────
create table if not exists production_events (
    id            uuid primary key default gen_random_uuid(),
    -- NO ACTION (not cascade): production history is immutable evidence, so an order
    -- carrying it cannot be deleted, only cancelled. Same trade payments→orders makes.
    order_item_id uuid not null references order_items(id),
    stage_code    text not null references production_stage_defs(code),
    kind          text not null check (kind in ('started', 'done', 'blocked', 'unblocked')),
    note          text,
    media_id      uuid,                  -- FK added in 0025 (media does not exist yet)
    actor         uuid references salespersons(id),
    at            timestamptz not null default now()
    -- NO updated_at: rows are immutable (forbid_production_event_mutation below).
);

-- Item stage timeline: 09 get_item_stage_state, 10 history accordion, 11 drawer.
create index if not exists production_events_item_at_idx
    on production_events (order_item_id, at desc);

-- 11 realtime reconnect backfill ("events since T"); 13 pilot same-day-entry metric.
create index if not exists production_events_at_idx
    on production_events (at desc);

-- A stage may be completed EXACTLY ONCE per item. This is the hard DB backstop for
-- the concurrent double-tap from a flaky phone network (EXECUTION_PLAN §4 module 09
-- risk), independent of 09's SELECT ... FOR UPDATE: the losing parallel INSERT hits
-- unique_violation and the API maps it to 409.
-- CONSEQUENCE, accepted by the client (2026-07-26): REWORK IS NOT MODELLED. A failed
-- quality inspection does not send an item back a stage — the stage simply stays
-- incomplete (no `done` event) and the item is `blocked` with a note until fixed.
create unique index if not exists production_events_one_done_per_stage
    on production_events (order_item_id, stage_code) where kind = 'done';

-- Hard append-only: blocks UPDATE/DELETE for everyone INCLUDING the service role
-- (grants and RLS cannot). Same shape as forbid_payment_mutation() (0016).
create or replace function forbid_production_event_mutation()
returns trigger language plpgsql as $$
begin
    raise exception 'production_events are append-only; insert a corrective event instead'
        using errcode = 'insufficient_privilege';
end;
$$;

create trigger production_events_immutable
    before update or delete on production_events
    for each row execute function forbid_production_event_mutation();

-- TRUNCATE deliberately NOT blocked. It fires only STATEMENT-level triggers, so a
-- `before truncate` guard would be needed — and it would also reject the RLS test
-- fixture's legitimate `truncate customers … cascade` (which reaches this table
-- through order_items), breaking the whole harness. The real mitigation is
-- privilege, not a trigger: no role is granted TRUNCATE here (authenticated gets
-- SELECT only, and the API never issues one), so this matches the payments
-- precedent (0016) rather than inventing a stricter, harness-hostile rule.

-- ─── Denorm trigger ──────────────────────────────────────────────────────────
-- SECURITY DEFINER (matching audit_status_change) so the denorm UPDATEs are never
-- silently row-filtered by the caller's RLS — an RLS-filtered UPDATE returns zero
-- rows WITHOUT error, which is exactly the silent failure CLAUDE.md forbids.
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
        return null;                    -- 'started' is informational only
    end if;

    select order_id, current_stage into v_order_id, v_cur
      from order_items where id = new.order_item_id;
    if v_order_id is null then
        return null;                    -- unreachable (FK), defensive
    end if;

    -- current_stage IS NULL means the item was never allocated, so production never
    -- started. The trigger declines to invent a timeline for it: initialising
    -- current_stage is the allocate API's job (scope fence above), and an unallocated
    -- item must not drag its order into 'in_production'. Module 09 rejects an advance
    -- on an unallocated item with a 409; this is the matching DB-side no-op.
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
        -- Last stage completed. current_stage STAYS put; the timestamp is the marker.
        update order_items
           set current_stage_at   = now(),
               production_done_at = coalesce(production_done_at, now())
         where id = new.order_item_id;
    else
        -- MONOTONIC ONLY: no event — however ordered, duplicated or backfilled — may
        -- drag current_stage backwards. This is what makes module 09's admin
        -- override-stage safe (it inserts `done` rows for every skipped stage).
        --
        -- The guard lives in the WHERE clause, NOT in an `if` on the v_cur read
        -- above, on purpose. production_events_one_done_per_stage only blocks a
        -- duplicate of the SAME stage; two `done` events for DIFFERENT stages on one
        -- item can still race. Re-checking against the row's committed value at
        -- lock-acquisition time closes that TOCTOU at the DB, so the invariant does
        -- not depend on every future caller remembering module 09's FOR UPDATE.
        update order_items
           set current_stage = v_next, current_stage_at = now()
         where id = new.order_item_id
           and current_stage is not null
           and v_next_sort > (select sort from production_stage_defs
                               where code = order_items.current_stage);
    end if;

    -- Order-level denorm. BOTH updates are status-GUARDED, so the only edges this
    -- trigger can traverse are confirmed→in_production and in_production→ready —
    -- exactly the two that services/order_status.py ALLOWED_TRANSITIONS permits.
    -- The guard is not an optimisation, it is the map-compliance mechanism: a
    -- cancelled order is never resurrected and a delivered one never regresses.
    -- "First done on the order" is not detected at all — the first event matches
    -- one row, every later one matches zero. One PK lookup, no scan.
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

create trigger production_events_apply
    after insert on production_events
    for each row execute function production_event_apply();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Assignments + events are SELECT-only for the browser; all writes are service-role
-- (module 09's API), matching alerts/documents. accounts are deliberately excluded
-- from both: accounts see money, not production.
alter table order_item_assignments enable row level security;
alter table production_events      enable row level security;
grant select on order_item_assignments to authenticated;
grant select on production_events      to authenticated;

create policy oia_select on order_item_assignments for select to authenticated
    using (is_owner() or is_role(array['admin'])
        or is_workshop_manager_of(workshop_id)
        or exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                    where oi.id = order_item_assignments.order_item_id
                      and is_assigned_to_customer(o.customer_id)));

-- LOAD-BEARING FOR MODULE 11: Supabase Realtime evaluates this policy per subscriber
-- per row. If it is wrong the live board silently receives nothing.
create policy pe_select on production_events for select to authenticated
    using (is_owner() or is_role(array['admin'])
        or exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                    where oi.id = production_events.order_item_id
                      and (is_assigned_to_customer(o.customer_id)
                           or is_workshop_manager_of(oi.workshop_id))));

-- ─── Realtime publication (folded forward from module 11) ────────────────────
-- Same guarded pattern as 0010_alerts / 0021_messages_realtime: idempotent, and a
-- no-op where the publication does not exist (the pgtest harness). Done here so
-- module 11 needs no migration and no extra prod push.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'production_events'
    ) then
        execute 'alter publication supabase_realtime add table production_events';
    end if;
exception
    when undefined_object then
        null;  -- publication not present in this environment; realtime configured elsewhere
end $$;
