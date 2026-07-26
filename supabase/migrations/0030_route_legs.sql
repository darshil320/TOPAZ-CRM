-- Topaz CRM — 0030 · multi-workshop route legs + due date AND TIME (module 14)
-- An order item stops belonging to ONE workshop for its whole life and gains a
-- ROUTE: an ordered plan of legs, each leg being (workshop, stage span, days, due_at).
-- The client's ask, verbatim: "for polishing in one workshop within 5 days then to
-- finishing up to another workshop within 4 days".
--
-- ─── WHY A NEW TABLE INSTEAD OF WIDENING order_item_assignments (spec D5) ──────
-- order_item_assignments_one_active (0024) is load-bearing in four places: the
-- sync_order_item_workshop() denorm, oia_select, pe_select's realtime scoping (via
-- order_items.workshop_id), and order_items_unallocated_idx. Relaxing it to "many
-- active" would silently change all four.
-- So the split is: LEGS ARE THE PLAN, ASSIGNMENTS ARE THE PRESENT. Activating a leg
-- inserts an assignment row through the existing allocate path, which means every
-- consumer shipped in 08/09/11/13 keeps working with no edit at all.
--
-- ─── TRIGGER SCOPE FENCE (as 0024) ────────────────────────────────────────────
-- The triggers here may ONLY: (a) keep order_item_assignments.due_date in step with
-- the new due_at, and (b) reject a leg whose stage span runs backwards. They may NOT
-- activate legs, create transfers, or advance stages — leg transitions are business
-- logic and live in api/routing.py + api/transfers.py (module 14 D7).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Legs ────────────────────────────────────────────────────────────────────
-- status semantics:
--   pending    — planned, the item has not reached this workshop yet
--   in_transit — the previous leg is done and the goods are moving here (0031 owns
--                the consignment; this is the leg-side mirror so the PWA can show
--                "coming to me" without joining the transfer tables)
--   active     — the goods are HERE and work is happening. At most one per item.
--   completed  — this workshop's stage span is fully done
--   cancelled  — the route was re-planned; the leg never happened
create table if not exists order_item_route_legs (
    id            uuid primary key default gen_random_uuid(),
    order_item_id uuid not null references order_items(id) on delete cascade,
    seq           int  not null check (seq > 0),
    workshop_id   uuid not null references workshops(id),
    stage_from    text not null references production_stage_defs(code),
    stage_to      text not null references production_stage_defs(code),
    planned_days  int  check (planned_days > 0),
    due_at        timestamptz,
    status        text not null default 'pending'
                  check (status in ('pending', 'in_transit', 'active', 'completed', 'cancelled')),
    activated_at  timestamptz,
    completed_at  timestamptz,
    created_by    uuid references salespersons(id),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create unique index if not exists order_item_route_legs_seq_uidx
    on order_item_route_legs (order_item_id, seq);

-- AT MOST ONE leg is where the work is happening. The DB backstop behind the receive
-- transaction's SELECT ... FOR UPDATE (0031) — a concurrent double-receive loses here
-- with unique_violation, which the API maps to 409 rather than upserting.
create unique index if not exists order_item_route_legs_one_active
    on order_item_route_legs (order_item_id) where status = 'active';

-- The PWA's two lists: "at me" (active) and "coming to me" (in_transit/pending).
create index if not exists order_item_route_legs_workshop_idx
    on order_item_route_legs (workshop_id, status)
    where status in ('pending', 'in_transit', 'active');

-- Module 12's overdue scan. Mirrors order_item_assignments_due_idx (0024).
create index if not exists order_item_route_legs_due_idx
    on order_item_route_legs (due_at)
    where status = 'active' and due_at is not null;

create trigger order_item_route_legs_set_updated_at
    before update on order_item_route_legs for each row execute function set_updated_at();

-- ─── Stage-span sanity, in the DB as well as the API ──────────────────────────
-- sort(stage_from) <= sort(stage_to) cannot be a CHECK constraint: a CHECK may not
-- read another table (production_stage_defs holds the sort). So it is a trigger.
-- CROSS-ROW rules (leg n+1 starts at the stage after leg n's stage_to; the legs
-- together cover the span with no gap and no overlap) stay in the API — a row-level
-- trigger cannot see the sibling rows of a not-yet-committed route.
create or replace function check_route_leg_span()
returns trigger language plpgsql stable set search_path = public as $$
declare
    v_from int;
    v_to   int;
begin
    select sort into v_from from production_stage_defs where code = new.stage_from;
    select sort into v_to   from production_stage_defs where code = new.stage_to;
    if v_from is null or v_to is null then
        raise exception 'unknown production stage in route leg (% → %)',
            new.stage_from, new.stage_to using errcode = 'foreign_key_violation';
    end if;
    if v_from > v_to then
        raise exception 'route leg stage span runs backwards: % comes after %',
            new.stage_from, new.stage_to using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

create trigger order_item_route_legs_check_span
    before insert or update of stage_from, stage_to on order_item_route_legs
    for each row execute function check_route_leg_span();

-- ─── order_item_assignments: due date AND TIME, plus the leg backlink ─────────
-- The client asked for the TIME the goods are due, not just the day. due_at is the
-- real column from here on; due_date is KEPT and demoted to a trigger-maintained
-- denorm so that order_item_assignments_due_idx (0024) and every shipped `due_date`
-- read keep working untouched.
--
-- WHY A TRIGGER AND NOT A GENERATED COLUMN: `timestamptz at time zone 'Asia/Kolkata'`
-- is STABLE, not IMMUTABLE (the zone database can change), and Postgres only accepts
-- IMMUTABLE expressions in a generated column. Attempting it fails at migration time.
alter table order_item_assignments
    add column if not exists due_at       timestamptz,
    add column if not exists route_leg_id uuid references order_item_route_legs(id);

create index if not exists order_item_assignments_due_at_idx
    on order_item_assignments (due_at) where active = true and due_at is not null;

-- Asia/Kolkata, not the server's TimeZone setting: the showroom is in Surat and a
-- 30 Jul 00:30 IST deadline must never be stored as due_date = 2026-07-29.
-- Only derives when due_at is present, so the legacy date-only allocate path
-- (api/production.py POST /allocate) keeps writing due_date directly.
create or replace function sync_assignment_due_date()
returns trigger language plpgsql set search_path = public as $$
begin
    if new.due_at is not null then
        new.due_date := (new.due_at at time zone 'Asia/Kolkata')::date;
    end if;
    return new;
end;
$$;

create trigger order_item_assignments_sync_due_date
    before insert or update of due_at on order_item_assignments
    for each row execute function sync_assignment_due_date();

-- ─── order_items: the transit lock ───────────────────────────────────────────
-- Set while the item is on a lorry between workshops; NULL otherwise. Read by module
-- 09's advance guard: a stage tap on an item whose physical custody is unknown means
-- nothing, so advance 409s while this is non-null (module 14 D9). Block/unblock stay
-- allowed — the origin must be able to flag transit damage.
--
-- Bare uuid here, FK added in 0031: workshop_transfers does not exist yet. Same
-- forward-reference pattern production_events.media_id used across 0024 → 0025.
-- The column is trigger-owned (0031's sync_transfer_denorm) — never write it by hand.
alter table order_items
    add column if not exists transit_transfer_id uuid;

-- ─── Route templates ─────────────────────────────────────────────────────────
-- So nobody retypes "Polishing 5d at Sharma → Finishing 4d at Main Floor" per item.
create table if not exists production_route_templates (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    notes      text,
    active     boolean not null default true,
    created_by uuid references salespersons(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Two ACTIVE templates may not share a name — the route builder identifies a template
-- by name in a dropdown, so a duplicate is an operator trap. Same btrim+lower guard
-- as workshops_active_name_uidx (0023), and partial so a retired name is reusable.
create unique index if not exists production_route_templates_active_name_uidx
    on production_route_templates (lower(btrim(name))) where active = true;

create table if not exists production_route_template_legs (
    id           uuid primary key default gen_random_uuid(),
    template_id  uuid not null references production_route_templates(id) on delete cascade,
    seq          int  not null check (seq > 0),
    workshop_id  uuid not null references workshops(id),
    stage_from   text not null references production_stage_defs(code),
    stage_to     text not null references production_stage_defs(code),
    planned_days int  not null check (planned_days > 0),
    created_at   timestamptz not null default now(),
    constraint production_route_template_legs_seq_uniq unique (template_id, seq)
);

create trigger production_route_templates_set_updated_at
    before update on production_route_templates for each row execute function set_updated_at();

create trigger production_route_template_legs_check_span
    before insert or update of stage_from, stage_to on production_route_template_legs
    for each row execute function check_route_leg_span();

-- Seeded DELIBERATELY EMPTY, for exactly the reason workshops (0023) is: a
-- placeholder route can be applied to a real order item and drive it to a workshop
-- that does not exist. The /owner/admin Route templates tab IS the intake mechanism.

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Legs: SELECT-only for the browser, scoped exactly like oia_select (0024) plus the
-- leg's own workshop — a workshop's staff must see a leg that is still `pending` at
-- their site, which is how the PWA renders "coming to me". All writes are service-role
-- (api/routing.py), matching order_item_assignments and production_events.
alter table order_item_route_legs enable row level security;
grant select on order_item_route_legs to authenticated;

create policy oirl_select on order_item_route_legs for select to authenticated
    using (is_owner() or is_role(array['admin'])
        or is_workshop_manager_of(workshop_id)
        or exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                    where oi.id = order_item_route_legs.order_item_id
                      and is_assigned_to_customer(o.customer_id)));

-- Templates mirror products (0013) and workshops (0023): any staff reads (a route is
-- workshop names and day counts — no money), owner/admin writes. No delete grant:
-- a template referenced by nothing is still history; deactivate it.
alter table production_route_templates      enable row level security;
alter table production_route_template_legs enable row level security;
grant select, insert, update on production_route_templates to authenticated;
grant select, insert, update, delete on production_route_template_legs to authenticated;

create policy prt_select on production_route_templates for select to authenticated
    using (true);
create policy prt_write on production_route_templates for all to authenticated
    using (is_owner() or is_role(array['admin']))
    with check (is_owner() or is_role(array['admin']));

create policy prtl_select on production_route_template_legs for select to authenticated
    using (true);
-- DELETE is granted here (unlike everywhere else in this schema) because a template
-- leg is a line in a draft, not a record of anything that happened: editing a
-- template from 3 legs to 2 has to be able to remove the third.
create policy prtl_write on production_route_template_legs for all to authenticated
    using (is_owner() or is_role(array['admin']))
    with check (is_owner() or is_role(array['admin']));

-- ─── Realtime (folded forward, as 0024 did for production_events) ────────────
-- The live production board's Transit lane subscribes to leg status changes. Same
-- guarded, idempotent shape as 0010_alerts / 0021_messages_realtime / 0024: a no-op
-- where the publication does not exist (the pgtest harness has none).
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'order_item_route_legs'
    ) then
        execute 'alter publication supabase_realtime add table order_item_route_legs';
    end if;
exception
    when undefined_object then
        null;  -- publication not present in this environment
end $$;
