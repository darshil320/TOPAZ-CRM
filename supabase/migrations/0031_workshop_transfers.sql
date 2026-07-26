-- Topaz CRM — 0031 · inter-workshop transfers, the mediator's state machine (module 14)
-- The client's ask: "mediator app for sending the product with its data to another
-- workshop, like for delivery guy who knows which product to transfer to which
-- workshop". A transfer is a CONSIGNMENT: goods moving from one workshop to another,
-- carried by a courier, with a two-party handover.
--
-- ─── NOT `deliveries` (0026) ──────────────────────────────────────────────────
-- 0026 models order → CUSTOMER delivery (Phase 2C). This models workshop → WORKSHOP
-- movement mid-production. They differ in every column that matters (no customer, no
-- e-way bill, a destination workshop that must CONFIRM receipt) and overloading one
-- table would make both sets of guards conditional. 0026's own defects are fixed at
-- the bottom of this file instead, because shipping a `delivery`-role app makes that
-- table reachable for the first time.
--
-- ─── TWO-PARTY HANDOVER (spec D10) ────────────────────────────────────────────
--   ready → picked_up → in_transit → delivered → received
--            ↑ courier says "I have it"      ↑ courier says "I dropped it"
--                                                        ↑ DESTINATION LEAD confirms
-- Only `received` moves custody. One-tap handover makes "lost in transit"
-- unattributable, which is the exact dispute this app exists to settle. A handover
-- photo is required at pickup and at delivery (enforced in api/transfers.py).
--
-- ─── MONEY ────────────────────────────────────────────────────────────────────
-- NO MONEY LIVES HERE AND NONE EVER MAY. The courier is a `delivery`-role user with
-- no order_items SELECT policy (that table carries unit_price/line_total/gst_rate);
-- their app reads a money-blind projection through the API only. The paperwork that
-- travels with the goods is the existing job_card_pdf (0027), which is money-free by
-- construction — that is what makes it safe to hand an outside vendor.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists workshop_transfers (
    id                     uuid primary key default gen_random_uuid(),
    transfer_no            text not null unique,      -- 'TRF-2627-0001' (doc_series, 0012)
    from_workshop_id       uuid not null references workshops(id),
    to_workshop_id         uuid not null references workshops(id),
    reason                 text not null default 'next_stage'
                           check (reason in ('next_stage', 'rework', 'capacity', 'other')),
    status                 text not null default 'ready'
                           check (status in ('ready', 'picked_up', 'in_transit',
                                             'delivered', 'received', 'cancelled')),
    -- Nullable: a vendor workshop that sends its own tempo has no courier in our
    -- system, and those items must still be trackable. The API lets a lead drive the
    -- whole state machine when courier_salesperson_id is null.
    courier_salesperson_id uuid references salespersons(id),
    vehicle_no             text,
    expected_pickup_at     timestamptz,
    due_at                 timestamptz,               -- when the DESTINATION must hold it
    picked_up_at           timestamptz,
    delivered_at           timestamptz,
    received_at            timestamptz,
    cancelled_at           timestamptz,
    cancel_reason          text,
    notes                  text,
    created_by             uuid references salespersons(id),
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    -- A transfer to the workshop the goods are already at is a data-entry bug that
    -- would strand the item: receive would activate a leg at the origin.
    constraint workshop_transfers_distinct_sites check (from_workshop_id <> to_workshop_id)
);

-- The mediator app's ENTIRE home screen is this index: "my open runs".
create index if not exists workshop_transfers_courier_idx
    on workshop_transfers (courier_salesperson_id, status)
    where status in ('ready', 'picked_up', 'in_transit', 'delivered');

-- The destination's "Incoming" section, and the origin's "Sent" list.
create index if not exists workshop_transfers_to_status_idx
    on workshop_transfers (to_workshop_id, status);
create index if not exists workshop_transfers_from_status_idx
    on workshop_transfers (from_workshop_id, status);

-- Module 12's watchdog: consignments sitting at `ready` past their pickup window.
create index if not exists workshop_transfers_pickup_idx
    on workshop_transfers (expected_pickup_at)
    where status = 'ready' and expected_pickup_at is not null;

create trigger workshop_transfers_set_updated_at
    before update on workshop_transfers for each row execute function set_updated_at();

-- ─── Consignment lines ───────────────────────────────────────────────────────
-- `open` is a DENORM of the parent's status (true while status not in
-- received/cancelled). It exists for one reason: a partial unique index cannot read
-- another table, and "an item may be in at most ONE open transfer" has to be a DB
-- backstop, not just an API convention — every other one-active invariant in this
-- schema (one primary per customer, one active assignment, one active lead) is
-- enforced by an index, and the receive/cancel transactions race in exactly the way
-- those indexes exist to catch.
create table if not exists workshop_transfer_items (
    id            uuid primary key default gen_random_uuid(),
    transfer_id   uuid not null references workshop_transfers(id) on delete cascade,
    order_item_id uuid not null references order_items(id) on delete cascade,
    route_leg_id  uuid references order_item_route_legs(id),
    qty           numeric,
    open          boolean not null default true,
    created_at    timestamptz not null default now(),
    constraint workshop_transfer_items_unique_pair unique (transfer_id, order_item_id)
);

create unique index if not exists workshop_transfer_items_one_open
    on workshop_transfer_items (order_item_id) where open = true;

create index if not exists workshop_transfer_items_transfer_idx
    on workshop_transfer_items (transfer_id);

-- ─── Append-only event stream ────────────────────────────────────────────────
-- Same shape and same reasoning as production_events (0024): a custody chain is
-- evidence. Separate table rather than reusing production_events because that one is
-- keyed (order_item_id, stage_code) with one `done` per pair — a consignment's state
-- is per-consignment, not per-item-stage.
create table if not exists workshop_transfer_events (
    id          uuid primary key default gen_random_uuid(),
    -- NO ACTION, not cascade: see production_events. A transfer carrying handover
    -- evidence is cancelled, never deleted.
    transfer_id uuid not null references workshop_transfers(id),
    kind        text not null check (kind in ('created', 'assigned', 'picked_up',
                                              'in_transit', 'delivered', 'received',
                                              'cancelled', 'note')),
    note        text,
    media_id    uuid references media(id),   -- the handover photo
    actor       uuid references salespersons(id),
    at          timestamptz not null default now()
    -- NO updated_at: rows are immutable (forbid_transfer_event_mutation below).
);

create index if not exists workshop_transfer_events_transfer_idx
    on workshop_transfer_events (transfer_id, at desc);

-- Hard append-only: blocks UPDATE/DELETE for everyone INCLUDING the service role
-- (grants and RLS cannot). Same shape as forbid_production_event_mutation() (0024)
-- and forbid_payment_mutation() (0016). TRUNCATE is deliberately not guarded, for
-- the reason recorded at 0024:225 — privilege, not a trigger, is the mitigation.
create or replace function forbid_transfer_event_mutation()
returns trigger language plpgsql as $$
begin
    raise exception 'workshop_transfer_events are append-only; insert a corrective event instead'
        using errcode = 'insufficient_privilege';
end;
$$;

create trigger workshop_transfer_events_immutable
    before update or delete on workshop_transfer_events
    for each row execute function forbid_transfer_event_mutation();

-- ─── order_items.transit_transfer_id: the FK, and its single writer ───────────
alter table order_items
    drop constraint if exists order_items_transit_transfer_fk;
alter table order_items
    add constraint order_items_transit_transfer_fk
    foreign key (transit_transfer_id) references workshop_transfers(id);

-- Serves module 09's advance guard ("is this item on a lorry right now?").
create index if not exists order_items_transit_idx
    on order_items (transit_transfer_id) where transit_transfer_id is not null;

-- Recomputed FROM SCRATCH, never copied from NEW, so receive and cancel both clear
-- the lock correctly without either path having to remember to.
create or replace function recompute_item_transit(p_item uuid)
returns void language sql security definer set search_path = public as $$
    update order_items oi
       set transit_transfer_id = (
               select ti.transfer_id from workshop_transfer_items ti
                where ti.order_item_id = p_item and ti.open = true
                limit 1)
     where oi.id = p_item;
$$;

create or replace function apply_transfer_denorm(p_transfer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_open boolean;
    v_item uuid;
begin
    select status not in ('received', 'cancelled') into v_open
      from workshop_transfers where id = p_transfer;
    if v_open is null then
        return;                          -- transfer already gone (cascade delete)
    end if;

    -- `open <> v_open` is not an optimisation: without it every recompute rewrites
    -- every line of the consignment, and each rewrite is a write the AFTER trigger
    -- below would have to be excluded from anyway.
    update workshop_transfer_items set open = v_open
     where transfer_id = p_transfer and open <> v_open;

    -- `open` must be settled BEFORE the item lock is recomputed: recompute reads it.
    for v_item in select order_item_id from workshop_transfer_items where transfer_id = p_transfer
    loop
        perform recompute_item_transit(v_item);
    end loop;
end;
$$;

-- SECURITY DEFINER throughout, matching audit_status_change / production_event_apply:
-- an RLS-filtered UPDATE returns zero rows WITHOUT error, which is exactly the silent
-- failure CLAUDE.md forbids.
create or replace function sync_transfer_denorm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    perform apply_transfer_denorm(coalesce(new.id, old.id));
    return null;
end;
$$;

create trigger workshop_transfers_sync_denorm
    after insert or update of status on workshop_transfers
    for each row execute function sync_transfer_denorm();

-- The items trigger also recomputes the SPECIFIC item, because on DELETE the row is
-- already gone and apply_transfer_denorm's loop would never visit it.
create or replace function sync_transfer_item_denorm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    perform apply_transfer_denorm(coalesce(new.transfer_id, old.transfer_id));
    perform recompute_item_transit(coalesce(new.order_item_id, old.order_item_id));
    return null;
end;
$$;

-- INSERT OR DELETE ONLY — deliberately NOT `or update`.
-- apply_transfer_denorm() writes workshop_transfer_items.open, so an UPDATE trigger
-- here would re-enter the same function and recurse until Postgres aborts the
-- statement with "stack depth limit exceeded" (which is exactly what it did, once).
-- Updates of `open` are always a CONSEQUENCE of the parent's status changing, and
-- workshop_transfers_sync_denorm below already covers that edge.
create trigger workshop_transfer_items_sync_denorm
    after insert or delete on workshop_transfer_items
    for each row execute function sync_transfer_item_denorm();

-- ─── media: the handover photo ───────────────────────────────────────────────
-- entity_type 'workshop_transfer' + kind 'transit'. This CHECK is only half the
-- change: services/media_entities.py (ENTITY_TABLES + VALID_PAIRINGS) is the API's
-- integrity boundary, since media.entity_id has no FK, and a type the API does not
-- know is an unreachable upload — defect H2 of the 2026-07-26 review, which added
-- entity types to a migration and never touched the Python.
--
-- supabase/storage/0025_media_policies.sql needs NO change, verified: its read rule
-- is a DENYLIST ("first path segment <> 'customer' OR caller is not
-- workshop_manager/delivery"), so `workshop_transfer/{id}/…` is readable by both the
-- couriers and the managers who need it, and customer media stays out of their reach.
alter table media drop constraint if exists media_entity_type_check;
alter table media add constraint media_entity_type_check
    check (entity_type in ('customer', 'order', 'order_item', 'production_event',
                           'delivery', 'product', 'quotation_item', 'workshop_transfer'));

alter table media drop constraint if exists media_kind_check;
alter table media add constraint media_kind_check
    check (kind in ('reference', 'drawing', 'site', 'production', 'finished',
                    'delivery', 'transit'));

-- media_site_is_customer_scoped (0025) is untouched and still pins 'site' to
-- 'customer' — the new type widens nothing about personal data.

-- ─── alerts: the new production signals ──────────────────────────────────────
-- 'leg_overdue'        — an active leg's due_at has passed with the span incomplete
-- 'transfer_pending'   — a consignment sat at `ready` past expected_pickup_at
-- 'production_blocked' — a workshop flagged an item stuck, with a reason
-- All three carry the order's customer_id, so alerts_select's existing assigned-staff
-- scoping keeps working with no policy change.
alter table alerts drop constraint if exists alerts_type_check;
alter table alerts add constraint alerts_type_check
    check (type in ('intent_call', 'intent_visit', 'confusion', 'buying_signal',
                    'leg_overdue', 'transfer_pending', 'production_blocked'));

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- SELECT-only for the browser; every write is service-role (api/transfers.py),
-- matching order_item_assignments / production_events.
--
-- The DESTINATION's staff must be able to read a transfer BEFORE receiving it — that
-- is the entire "Incoming" screen. The courier reads their own runs. Neither clause
-- exposes money: this table has none, and order_items stays unreadable to both roles.
alter table workshop_transfers        enable row level security;
alter table workshop_transfer_items   enable row level security;
alter table workshop_transfer_events  enable row level security;
grant select on workshop_transfers       to authenticated;
grant select on workshop_transfer_items  to authenticated;
grant select on workshop_transfer_events to authenticated;

create policy wt_select on workshop_transfers for select to authenticated
    using (is_owner() or is_role(array['admin'])
        or is_workshop_manager_of(from_workshop_id)
        or is_workshop_manager_of(to_workshop_id)
        or courier_salesperson_id = current_salesperson_id());

create policy wti_select on workshop_transfer_items for select to authenticated
    using (exists (select 1 from workshop_transfers t
                    where t.id = workshop_transfer_items.transfer_id
                      and (is_owner() or is_role(array['admin'])
                           or is_workshop_manager_of(t.from_workshop_id)
                           or is_workshop_manager_of(t.to_workshop_id)
                           or t.courier_salesperson_id = current_salesperson_id())));

create policy wte_select on workshop_transfer_events for select to authenticated
    using (exists (select 1 from workshop_transfers t
                    where t.id = workshop_transfer_events.transfer_id
                      and (is_owner() or is_role(array['admin'])
                           or is_workshop_manager_of(t.from_workshop_id)
                           or is_workshop_manager_of(t.to_workshop_id)
                           or t.courier_salesperson_id = current_salesperson_id())));

-- ─── Realtime: the board's Transit lane and the PWA's Incoming section ───────
do $$
declare
    t text;
begin
    foreach t in array array['workshop_transfers', 'workshop_transfer_events']
    loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table %I', t);
        end if;
    end loop;
exception
    when undefined_object then
        null;  -- publication not present in this environment
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ─── 0026_deliveries.sql defect fix ──────────────────────────────────────────
-- Recorded in STATE.md "Discoveries for later modules" (2C/REVIEW NEEDED) and fixed
-- HERE because module 14 ships the first `delivery`-role application, which is the
-- moment those defects stop being theoretical.
--
-- (1) 0026's policies are `using (true)` / `with check (true)` for SELECT/INSERT/
--     UPDATE to ALL authenticated — every other table in this schema scopes by
--     is_owner()/is_role()/is_assigned_to_customer(). As written a workshop_manager
--     reads every delivery and any staff member can rewrite any delivery.
-- (2) 0026 issues no `grant` at all, so the policies were inert and the table
--     unreachable from the browser regardless.
-- (3) `updated_at` exists with no trigger to maintain it.
alter table deliveries      enable row level security;
alter table delivery_items  enable row level security;

drop policy if exists deliveries_authenticated_select on deliveries;
drop policy if exists deliveries_authenticated_insert on deliveries;
drop policy if exists deliveries_authenticated_update on deliveries;
drop policy if exists delivery_items_authenticated_select on delivery_items;
drop policy if exists delivery_items_authenticated_insert on delivery_items;

grant select on deliveries     to authenticated;
grant select on delivery_items to authenticated;

-- Read: owner/admin, the assigned driver, or the order's assigned salesperson.
-- Writes are service-role only, consistent with every other Phase-2B write path —
-- the dashboard's delivery actions must route through the API, not Supabase direct.
create policy deliveries_select on deliveries for select to authenticated
    using (is_owner() or is_role(array['admin'])
        or driver_salesperson_id = current_salesperson_id()
        or exists (select 1 from orders o where o.id = deliveries.order_id
                    and is_assigned_to_customer(o.customer_id)));

create policy delivery_items_select on delivery_items for select to authenticated
    using (exists (select 1 from deliveries d where d.id = delivery_items.delivery_id
                    and (is_owner() or is_role(array['admin'])
                         or d.driver_salesperson_id = current_salesperson_id()
                         or exists (select 1 from orders o where o.id = d.order_id
                                     and is_assigned_to_customer(o.customer_id)))));

drop trigger if exists deliveries_set_updated_at on deliveries;
create trigger deliveries_set_updated_at
    before update on deliveries for each row execute function set_updated_at();
