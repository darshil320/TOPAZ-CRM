-- Topaz CRM — 0040 · one delivery, MANY orders (and many customers)
--
-- The client's ask, verbatim in shape: ORD-1's Central Table is finished and ORD-2's Sofa
-- is finished, so send both on one lorry and let the rest of both orders follow later.
--
-- 0039 already made a delivery a set of ITEMS. What it did not do is let those items come
-- from more than one order: `deliveries.order_id` is a NOT NULL FK (0026) and
-- `schedule_delivery` raises 'Item % does not belong to this order'. Every consumer —
-- RLS, the challan, the driver PWA, the order page — reads the run's single order through
-- that column.
--
-- ─── THE FOUR MODELLING DECISIONS ─────────────────────────────────────────────
--
--  1. **A DELIVERY IS A LORRY RUN. It has no order and no customer.** The mapping back to
--     the originating order lives on `delivery_items`, which is where the goods are.
--     `deliveries.order_id` is kept and still populated (see 4) purely so every pre-0040
--     reader keeps working; 0042 drops it.
--
--  2. **A CONSIGNMENT is the paperwork grain: one per (delivery, customer).** A challan is
--     the paper one recipient signs for the goods on one lorry (0037). Two orders of the
--     same customer on one run therefore share ONE challan listing both orders' pieces —
--     which is what their pad does. Two customers get two challans, two ship-to addresses,
--     two balance figures. Hanging the challan off the DELIVERY (as 0037 did) would produce
--     one document that is wrong for both customers; hanging it off the ORDER would produce
--     two documents for one signature. `(delivery, customer)` is the only grain that is
--     right, and it keeps every consignment single-customer — so the authorization check in
--     api/documents.py stays a one-customer check instead of becoming an N-customer loop.
--
--  3. **AUTHORIZATION MOVES INTO THE FUNCTION, AND THE FUNCTION BECOMES DEFINER.** 0039
--     deliberately used SECURITY INVOKER so 0033's RLS stayed the boundary. That stops
--     working here: the `deliveries` header row is inserted BEFORE its items exist, so a
--     `with check` on it cannot see which orders the run touches — RLS alone cannot express
--     "the caller is authorized for all N orders". So `schedule_delivery` is now DEFINER and
--     checks every distinct order itself, with the same vocabulary the policies use
--     (is_owner / is_role / is_assigned_to_customer). 0041 then REVOKES direct INSERT on
--     `deliveries`, which makes this the single write path and is strictly tighter than
--     today's browser insert.
--
--  4. **THIS MIGRATION IS ADDITIVE AND CHANGES NO EXISTING BEHAVIOUR.** It ships before
--     the API and dashboard deploys. Two things make that safe:
--       · `deliveries.order_id` stays NOT NULL and is written with the run's primary order,
--         so `tasks/challan.py`, `api/documents.py`, the order page's `.eq("order_id", id)`
--         and 0031/0033's policies all keep working untouched.
--       · `delivery_items.received` defaults TRUE, so a completed run stamps its goods
--         exactly as 0039 did until the driver PWA starts writing the driver's ticks.
--     A mixed-order delivery cannot exist until the dashboard that creates one is deployed,
--     so there is no window in which old code can misread new data.
--
-- Migration sequence: 0040 (this, additive) → API deploy → dashboard deploy →
-- 0041 (revoke the old write path) → soak → 0042 (drop deliveries.order_id and the four
-- challan columns that moved to consignments).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1 · Consignments — the paperwork grain ───────────────────────────────────
-- The four columns 0037 put on `deliveries` belong here: they are all per-recipient.
-- They remain on `deliveries` until 0042 so this migration breaks no reader.
create table if not exists delivery_consignments (
    id               uuid primary key default gen_random_uuid(),
    delivery_id      uuid not null references deliveries(id) on delete cascade,
    customer_id      uuid not null references customers(id),
    -- Allocated ONCE by tasks/challan.py and reused by every re-render, exactly as
    -- deliveries.challan_no was (0037). UNIQUE across the whole series: the number is what
    -- a checking officer quotes back weeks later.
    challan_no       text unique,
    delivery_address text,
    delivery_rent    numeric(12,2) check (delivery_rent is null or delivery_rent >= 0),
    dp_code          text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint delivery_consignments_one_per_customer unique (delivery_id, customer_id)
);

create index if not exists delivery_consignments_customer_idx
    on delivery_consignments (customer_id);

drop trigger if exists delivery_consignments_set_updated_at on delivery_consignments;
create trigger delivery_consignments_set_updated_at
    before update on delivery_consignments for each row execute function set_updated_at();

comment on table delivery_consignments is
    'One per (delivery, customer): the goods on one lorry for one recipient, i.e. exactly '
    'one challan. A mixed-order run for one customer has ONE consignment covering both '
    'orders; a run for two customers has two (0040).';

-- ─── 2 · delivery_items carries the mapping back to the order ─────────────────
-- order_id / customer_id are DENORMALISED from order_items, following the idiom this
-- schema already uses three times (sync_order_item_workshop 0024, sync_workshop_lead 0029,
-- delivery_items.delivery_status 0039). Without them, RLS on delivery_items would need
-- delivery_items → order_items → orders on every row, and reporting "which orders are
-- part-shipped" would have no index to stand on.
alter table delivery_items
    add column if not exists order_id       uuid references orders(id),
    add column if not exists customer_id    uuid references customers(id),
    add column if not exists consignment_id uuid references delivery_consignments(id) on delete set null,
    -- The driver's tick, PERSISTED. Until 0040 the PWA held it in React state and threw it
    -- away, so "the customer got 2 of the 3 pieces" was never recorded anywhere.
    -- DEFAULT TRUE is load-bearing: the deployed PWA does not write this column yet, and a
    -- run completing in that window must still stamp its goods the way 0039 did.
    add column if not exists received       boolean not null default true,
    add column if not exists received_at    timestamptz;

create index if not exists delivery_items_order_idx       on delivery_items (order_id);
create index if not exists delivery_items_customer_idx    on delivery_items (customer_id);
create index if not exists delivery_items_consignment_idx on delivery_items (consignment_id);

comment on column delivery_items.received is
    'Did this piece actually change hands on this run? Written by the driver PWA. Defaults '
    'TRUE so a run completed before the PWA deploy behaves exactly as it did under 0039.';

-- ─── 3 · The denorm is the database''s, never the client''s ───────────────────
-- Replaces 0039's sync_delivery_item_status(), which only carried the parent status down.
-- Renamed because the old name would now be a lie. Still PURE DENORM: it makes no
-- business decision, creates no consignment, and refuses nothing — those belong to
-- schedule_delivery() below (the same trigger scope fence 0024 and 0030 state).
drop trigger if exists delivery_items_sync_status on delivery_items;
drop trigger if exists deliveries_sync_item_status on deliveries;
drop function if exists sync_delivery_item_status();

create or replace function sync_delivery_item_denorm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    -- INSERT/UPDATE on the child: every denormalised column is re-derived from the source
    -- of truth, so a client-supplied value is overwritten rather than trusted. This is what
    -- makes "which order did this piece come from" unforgeable.
    if tg_table_name = 'delivery_items' then
        select status into new.delivery_status from deliveries where id = new.delivery_id;
        select oi.order_id, o.customer_id
          into new.order_id, new.customer_id
          from order_items oi join orders o on o.id = oi.order_id
         where oi.id = new.order_item_id;
        -- Link to the recipient's paperwork if it exists. NOT created here: inventing a
        -- consignment as a side effect of an item insert would create paperwork nobody
        -- asked for. schedule_delivery() creates them first, so the lookup always hits.
        select dc.id into new.consignment_id
          from delivery_consignments dc
         where dc.delivery_id = new.delivery_id and dc.customer_id = new.customer_id;
        return new;
    end if;
    -- UPDATE of deliveries.status: push it down to every child (0039's behaviour, kept —
    -- delivery_items_one_open is a partial index on this column).
    update delivery_items set delivery_status = new.status where delivery_id = new.id;
    return new;
end;
$$;

comment on function sync_delivery_item_denorm() is
    'Denormalises deliveries.status, order_items.order_id, orders.customer_id and the '
    'matching consignment onto delivery_items. SECURITY DEFINER so a delivery-role user '
    'can insert a line without read privileges on orders. Pure denorm — no business rule.';

create trigger delivery_items_sync_denorm
    before insert or update of delivery_id, order_item_id on delivery_items
    for each row execute function sync_delivery_item_denorm();

create trigger deliveries_sync_item_status
    after update of status on deliveries
    for each row execute function sync_delivery_item_denorm();

-- Backfill before anything reads the new columns.
update delivery_items di
   set order_id    = oi.order_id,
       customer_id = o.customer_id
  from order_items oi
  join orders o on o.id = oi.order_id
 where oi.id = di.order_item_id
   and (di.order_id is null or di.customer_id is null);

-- ─── 4 · Legacy deliveries get their consignment ──────────────────────────────
-- Every pre-0040 delivery is one order, hence exactly one recipient. Its challan number
-- and paperwork move across; the columns on `deliveries` stay until 0042 so the currently
-- deployed challan worker still finds them.
insert into delivery_consignments (delivery_id, customer_id, challan_no, delivery_address,
                                   delivery_rent, dp_code)
select d.id, o.customer_id, d.challan_no, d.delivery_address, d.delivery_rent, d.dp_code
  from deliveries d
  join orders o on o.id = d.order_id
 on conflict (delivery_id, customer_id) do nothing;

update delivery_items di
   set consignment_id = dc.id
  from delivery_consignments dc
 where dc.delivery_id = di.delivery_id
   and dc.customer_id = di.customer_id
   and di.consignment_id is null;

-- A run that already went out demonstrably handed its goods over.
update delivery_items di
   set received_at = coalesce(d.delivered_at, d.updated_at)
  from deliveries d
 where d.id = di.delivery_id
   and d.status = 'delivered'
   and di.received
   and di.received_at is null;

-- ─── 5 · Fulfilment: Not / Partially / Fully delivered ────────────────────────
-- A NEW COLUMN, deliberately NOT a widened `orders.status`. `orders.status` is the sales
-- pipeline: it drives ALLOWED_TRANSITIONS (services/order_status.py), NEXT_TRANSITIONS in
-- the UI, the audit trigger and the delivery picker's own filter. Adding
-- 'partially_delivered' to it would touch all four and could drift from the item facts.
-- A separate column cannot corrupt the pipeline, and `orders.status` keeps its 0039
-- meaning: it reaches 'delivered' only when nothing is left.
alter table orders
    add column if not exists fulfillment_status text not null default 'not_delivered'
        check (fulfillment_status in ('not_delivered', 'partially_delivered', 'fully_delivered'));

comment on column orders.fulfillment_status is
    'Derived from order_items.delivered_at by sync_order_fulfillment(). Separate from '
    'orders.status ON PURPOSE — status is the sales pipeline (0040).';

-- The set the delivery picker must offer: anything not finished. A part-shipped order MUST
-- stay pickable or the rest of it could never be scheduled.
create index if not exists orders_fulfillment_open_idx
    on orders (fulfillment_status)
    where fulfillment_status <> 'fully_delivered';

-- ─── THE RULE, IN ONE PLACE ───────────────────────────────────────────────────
-- Pure, IMMUTABLE, no table reads, so the trigger and the view cannot drift apart.
--
-- ─── WHY orders.status IS AN INPUT ───────────────────────────────────────────
-- `order_items.delivered_at` only exists for goods that went out THROUGH a delivery. An
-- order marked 'installed' or 'closed' by hand — the normal path before per-item delivery
-- existed, and still the path when somebody corrects the record — has no stamped items at
-- all. Deriving from the items alone would label such an order "Not delivered" while its
-- own status says the furniture is standing in the customer's house, which is a visibly
-- wrong answer on the orders list.
--
-- So a TERMINAL DELIVERED STATE WINS: for those, the order's own status is the more
-- authoritative record and the item stamps are simply missing history. 'cancelled' is
-- deliberately NOT in that set — a cancelled order's goods did not go anywhere.
create or replace function compute_order_fulfillment(p_status text, p_total int, p_done int)
returns text language sql immutable as $$
    select case
        when p_status in ('delivered', 'installed', 'closed') then 'fully_delivered'
        -- An order with no items reads NOT delivered: count = 0 = count must not be
        -- mistaken for "everything went out".
        when coalesce(p_done, 0) = 0      then 'not_delivered'
        when p_done < p_total             then 'partially_delivered'
        else                                   'fully_delivered'
    end;
$$;

comment on function compute_order_fulfillment(text, int, int) is
    'The Not/Partially/Fully rule, shared by the sync triggers and the order_fulfillment '
    'view so they cannot disagree. A terminal delivered order status wins over missing '
    'item stamps (0040).';

create or replace function sync_order_fulfillment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_order  uuid := coalesce(new.order_id, old.order_id);
    v_total  int;
    v_done   int;
    v_status text;
begin
    if v_order is null then return coalesce(new, old); end if;
    select count(*), count(delivered_at) into v_total, v_done
      from order_items where order_id = v_order;
    select compute_order_fulfillment(o.status, v_total, v_done) into v_status
      from orders o where o.id = v_order;
    update orders set fulfillment_status = v_status
     where id = v_order and fulfillment_status is distinct from v_status;
    return coalesce(new, old);
end;
$$;

comment on function sync_order_fulfillment() is
    'Recomputes orders.fulfillment_status from its items. SECURITY DEFINER because a '
    'delivery-role user has no UPDATE on orders. Fires on delivered_at, on adding an item '
    'to an order, and on removing one.';

drop trigger if exists order_items_sync_fulfillment on order_items;
create trigger order_items_sync_fulfillment
    after insert or delete or update of delivered_at on order_items
    for each row execute function sync_order_fulfillment();

-- The order's OWN status is an input to the rule, so a status change has to recompute it.
-- BEFORE, writing NEW directly: an AFTER trigger issuing `update orders` from a trigger on
-- `orders` is the recursion this avoids entirely.
create or replace function sync_order_fulfillment_on_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_total int;
    v_done  int;
begin
    select count(*), count(delivered_at) into v_total, v_done
      from order_items where order_id = new.id;
    new.fulfillment_status := compute_order_fulfillment(new.status, v_total, v_done);
    return new;
end;
$$;

comment on function sync_order_fulfillment_on_status() is
    'Keeps fulfillment_status in step when an order''s status changes (e.g. marked '
    'installed by hand, which stamps no items). BEFORE UPDATE so it writes NEW and cannot '
    'recurse (0040).';

drop trigger if exists orders_sync_fulfillment on orders;
create trigger orders_sync_fulfillment
    before update of status on orders
    for each row execute function sync_order_fulfillment_on_status();

-- The same fact, computed rather than stored — the `order_outstanding` idiom (0016).
-- security_invoker so a salesperson sees only their own customers' orders.
create or replace view order_fulfillment with (security_invoker = true) as
    select o.id                        as order_id,
           count(oi.id)::int           as item_count,
           count(oi.delivered_at)::int as delivered_count,
           compute_order_fulfillment(o.status, count(oi.id)::int,
                                     count(oi.delivered_at)::int) as fulfillment
      from orders o
      left join order_items oi on oi.order_id = o.id
     group by o.id, o.status;

grant select on order_fulfillment to authenticated;

comment on view order_fulfillment is
    'Per-order delivered-item counts + Not/Partially/Fully. The column '
    'orders.fulfillment_status is the indexed mirror of this view; this view is the truth '
    'and the two are proven equal by tests/test_multi_order_deliveries_empirical.py.';

-- Backfill the column for every existing order.
update orders o
   set fulfillment_status = f.fulfillment
  from order_fulfillment f
 where f.order_id = o.id
   and o.fulfillment_status is distinct from f.fulfillment;

-- ─── 6 · Scheduling: one atomic, authorizing entry point ──────────────────────
-- ONE jsonb ARGUMENT ON PURPOSE. 0039 documented the trap: `create or replace` only
-- matches an identical argument list, so growing the signature leaves the old overload in
-- place and defaults on both make a call ambiguous. A single jsonb payload can never
-- collide with 0039's ten-argument uuid signature (which stays callable until 0041, so the
-- currently deployed dashboard keeps working), and the next field to appear needs no new
-- signature at all.
create or replace function schedule_delivery(p_delivery jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    -- The backend (FastAPI/Celery, and psql) bypasses RLS everywhere else in this schema
    -- by design (0005) and bypasses the per-order check here for the same reason. Every
    -- BROWSER session arrives with a verified claim — `authenticated` or `anon` — so it is
    -- checked. Written as "not service" rather than "is authenticated" so an anon caller
    -- falls on the enforced side of the branch.
    v_backend boolean := coalesce((select auth.role()), 'service_role') = 'service_role';
    v_items   uuid[];
    v_id      uuid;
    v_primary uuid;
    v_bad     uuid;
    v_cust    uuid;
    v_order   record;
begin
    if p_delivery is null or jsonb_typeof(p_delivery) <> 'object' then
        raise exception 'schedule_delivery expects a JSON object';
    end if;
    if coalesce(jsonb_typeof(p_delivery -> 'consignments'), 'array') <> 'array' then
        raise exception 'consignments must be a JSON array';
    end if;

    -- Refused rather than defaulted to "all items": guessing that an empty selection means
    -- the whole order is exactly how part-delivery silently stopped working before 0039.
    if jsonb_typeof(p_delivery -> 'items') <> 'array' then
        raise exception 'Select at least one item to deliver';
    end if;
    select array_agg((value #>> '{}')::uuid) into v_items
      from jsonb_array_elements(p_delivery -> 'items');
    if v_items is null or array_length(v_items, 1) is null then
        raise exception 'Select at least one item to deliver';
    end if;
    if exists (select 1 from unnest(v_items) x group by x having count(*) > 1) then
        raise exception 'The same item was selected twice';
    end if;

    select requested.id into v_bad
      from unnest(v_items) as requested(id)
      left join order_items oi on oi.id = requested.id
     where oi.id is null
     limit 1;
    if v_bad is not null then
        raise exception 'Item % does not exist', v_bad;
    end if;

    -- ─── The authorization boundary (decision 3 in the header) ───────────────
    -- Checked PER ORDER: without this, a salesperson could attach another salesperson's
    -- customer's goods to their own run and that customer's pieces would leave the
    -- building on paperwork nobody responsible for them ever saw.
    if not v_backend then
        for v_order in
            select distinct o.id, o.order_no, o.customer_id
              from unnest(v_items) as requested(id)
              join order_items oi on oi.id = requested.id
              join orders o on o.id = oi.order_id
        loop
            if not (is_owner() or is_role(array['admin'])
                    or is_assigned_to_customer(v_order.customer_id)) then
                raise exception 'You may not schedule a delivery for order %', v_order.order_no;
            end if;
        end loop;
    end if;

    -- Paperwork for a recipient with nothing on the lorry is meaningless, and it is the
    -- shape a copy-paste bug takes. The reverse (a recipient with no paperwork) is
    -- impossible by construction — consignments are DERIVED from the goods below.
    select (paper.value ->> 'customer_id')::uuid into v_cust
      from jsonb_array_elements(coalesce(p_delivery -> 'consignments', '[]'::jsonb)) as paper
     where (paper.value ->> 'customer_id')::uuid not in (
               select o.customer_id
                 from unnest(v_items) as requested(id)
                 join order_items oi on oi.id = requested.id
                 join orders o on o.id = oi.order_id)
     limit 1;
    if v_cust is not null then
        raise exception 'No goods on this delivery belong to customer %', v_cust;
    end if;

    -- The DEPRECATED `deliveries.order_id` (still NOT NULL). Deterministic — the run's
    -- oldest order — so it is always one of the run's real orders and never a guess.
    -- Dropped in 0042; delete these five lines with it.
    select o.id into v_primary
      from unnest(v_items) as requested(id)
      join order_items oi on oi.id = requested.id
      join orders o on o.id = oi.order_id
     order by o.created_at, o.order_no
     limit 1;

    insert into deliveries (order_id, driver_salesperson_id, scheduled_date,
                            vehicle_no, eway_bill_no, notes, status)
    values (v_primary,
            (p_delivery ->> 'driver_salesperson_id')::uuid,
            coalesce((p_delivery ->> 'scheduled_date')::date, current_date),
            nullif(btrim(p_delivery ->> 'vehicle_no'), ''),
            nullif(btrim(p_delivery ->> 'eway_bill_no'), ''),
            nullif(btrim(p_delivery ->> 'notes'), ''),
            'scheduled')
    returning id into v_id;

    -- One consignment per DISTINCT recipient among the goods, with whatever paperwork the
    -- caller supplied for them merged in. Derived, not accepted as a list: a run cannot
    -- end up with goods that have no challan, nor a challan with no goods.
    insert into delivery_consignments (delivery_id, customer_id, delivery_address,
                                       delivery_rent, dp_code)
    select v_id, recipients.customer_id,
           nullif(btrim(paper.value ->> 'delivery_address'), ''),
           nullif(btrim(paper.value ->> 'delivery_rent'), '')::numeric,
           nullif(btrim(paper.value ->> 'dp_code'), '')
      from (select distinct o.customer_id
              from unnest(v_items) as requested(id)
              join order_items oi on oi.id = requested.id
              join orders o on o.id = oi.order_id) as recipients
      left join lateral (
          select value
            from jsonb_array_elements(coalesce(p_delivery -> 'consignments', '[]'::jsonb))
           where (value ->> 'customer_id')::uuid = recipients.customer_id
           limit 1
      ) as paper on true;

    -- order_id, customer_id and consignment_id are filled by the denorm trigger, which is
    -- why the consignments must already exist at this point.
    insert into delivery_items (delivery_id, order_item_id)
    select v_id, item_id from unnest(v_items) as item_id;

    return v_id;
end;
$$;

comment on function schedule_delivery(jsonb) is
    'Creates a lorry run, its per-customer consignments and its item lines in ONE '
    'transaction, for items drawn from ANY NUMBER OF ORDERS (0040). SECURITY DEFINER: it '
    'authorizes every distinct order itself, because a with-check on the deliveries header '
    'cannot see items that do not exist yet. Raises on an empty or duplicated selection, an '
    'unknown item, an order the caller may not write, a consignment for a customer with no '
    'goods, and (via delivery_items_one_open) on a double-booked item.';

grant execute on function schedule_delivery(jsonb) to authenticated;

-- ─── 7 · Completion: per item, then per order ─────────────────────────────────
-- 0039's version counted remaining items for ONE order and wrote ONE audit row. With a
-- mixed run that is wrong twice: the orders that were fully covered would not close, and
-- the dispatch history would record the run against only one of them.
create or replace function advance_order_after_delivery(
    p_order uuid, p_delivery uuid, p_notes text
) returns void language plpgsql security definer set search_path = public as $$
declare
    v_remaining int;
begin
    select count(*) into v_remaining
      from order_items where order_id = p_order and delivered_at is null;

    -- Terminal states are left alone: a cancelled or closed order must not be dragged
    -- backwards by a late tap on a phone that was offline (0033).
    if v_remaining = 0 then
        update orders set status = 'delivered', updated_at = now()
         where id = p_order
           and status not in ('delivered', 'installed', 'closed', 'cancelled');
    end if;

    insert into audit_log (entity, entity_id, action, actor, payload)
    values ('orders', p_order, 'delivered',
            coalesce(current_salesperson_id()::text, 'system'),
            jsonb_build_object('delivery_id', p_delivery, 'notes', p_notes,
                               'items_remaining', v_remaining));
end;
$$;

comment on function advance_order_after_delivery(uuid, uuid, text) is
    'One order''s share of a completed run: close it if nothing of it is left, and audit '
    'the run against it either way. Called once per order on the run (0040).';

create or replace function on_delivery_completed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_order record;
begin
    if new.status = 'delivered' and coalesce(old.status, '') <> 'delivered' then
        update delivery_items
           set received_at = coalesce(new.delivered_at, now())
         where delivery_id = new.id and received and received_at is null;

        -- ONLY what the driver marked received. `received` defaults TRUE, so until the PWA
        -- writes the ticks this stamps the whole run exactly as 0039 did.
        update order_items oi
           set delivered_at = coalesce(new.delivered_at, now())
          from delivery_items di
         where di.delivery_id = new.id
           and oi.id = di.order_item_id
           and di.received
           and oi.delivered_at is null;

        for v_order in
            select distinct order_id from delivery_items
             where delivery_id = new.id and order_id is not null
            union
            -- A pre-0039 run with no item rows meant "the whole order". 0039 backfilled
            -- those, so this branch should find nothing; it exists so a row that escaped
            -- the backfill still closes its order. Remove with order_id in 0042.
            select new.order_id
             where not exists (select 1 from delivery_items where delivery_id = new.id)
        loop
            perform advance_order_after_delivery(v_order.order_id, new.id, new.notes);
        end loop;
    end if;
    return new;
end;
$$;

comment on function on_delivery_completed() is
    'Stamps delivered_at for the items the driver actually received, then advances EVERY '
    'order the run touched on its own remaining-items count, auditing each (0040). '
    'SECURITY DEFINER because the delivery role has neither privilege directly.';

-- ─── 8 · RLS: scope through the items, not through a single order ─────────────
-- 0031's policies reach the customer via `deliveries.order_id`. That column is about to
-- stop meaning anything, so the route becomes `delivery_items.customer_id` — which is why
-- it was denormalised in step 2. The vocabulary is unchanged: owner / admin / the assigned
-- driver / the salesperson assigned to the customer. Nothing here is `true`.
--
-- The INSERT policies from 0033 are deliberately NOT touched: the currently deployed
-- dashboard still inserts through 0039's SECURITY INVOKER function and needs them. 0041
-- revokes that path once the new dashboard is live.
--
-- ─── WHY TWO HELPER FUNCTIONS AND NOT TWO SUBQUERIES ─────────────────────────
-- A policy's subquery runs under the querying user, so RLS applies to the table it reads.
-- `deliveries` must ask about its items and `delivery_items` must ask about its driver —
-- written as plain EXISTS that is a cycle, and Postgres rejects it outright:
--
--     infinite recursion detected in policy for relation "delivery_items"
--
-- SECURITY DEFINER helpers break it, which is exactly what is_owner() /
-- is_assigned_to_customer() already are (0004) and the same trust model: they answer one
-- boolean about the CURRENT user and expose no rows.
create or replace function is_delivery_driver(p_delivery_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from deliveries
        where id = p_delivery_id
          and driver_salesperson_id = current_salesperson_id()
    );
$$;

create or replace function is_delivery_for_my_customer(p_delivery_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from delivery_items di
        where di.delivery_id = p_delivery_id
          and is_assigned_to_customer(di.customer_id)
    );
$$;

comment on function is_delivery_driver(uuid) is
    'RLS helper: is the current user the driver of this run? SECURITY DEFINER so the '
    'delivery_items policies can ask without recursing into the deliveries policy (0040).';
comment on function is_delivery_for_my_customer(uuid) is
    'RLS helper: does this run carry goods belonging to a customer the current user is '
    'assigned to? The multi-order replacement for 0031''s deliveries.order_id join.';

drop policy if exists deliveries_select on deliveries;
create policy deliveries_select on deliveries for select to authenticated
    using (is_owner() or is_role(array['admin'])
        or driver_salesperson_id = current_salesperson_id()
        or is_delivery_for_my_customer(id));

drop policy if exists deliveries_update on deliveries;
create policy deliveries_update on deliveries for update to authenticated
    using (is_owner() or is_role(array['admin'])
        or driver_salesperson_id = current_salesperson_id()
        or is_delivery_for_my_customer(id))
    with check (is_owner() or is_role(array['admin'])
        or driver_salesperson_id = current_salesperson_id()
        or is_delivery_for_my_customer(id));

drop policy if exists delivery_items_select on delivery_items;
create policy delivery_items_select on delivery_items for select to authenticated
    using (is_owner() or is_role(array['admin'])
        or is_assigned_to_customer(customer_id)
        or is_delivery_driver(delivery_id));

-- The driver's tick is the only client-writable column on this table. A COLUMN-LEVEL grant
-- is the boundary, not a convention: repointing `order_item_id` would move goods between
-- runs with no audit trail, and rewriting `consignment_id` would move them onto another
-- customer's challan.
grant update (received) on delivery_items to authenticated;

drop policy if exists delivery_items_update on delivery_items;
create policy delivery_items_update on delivery_items for update to authenticated
    using (is_owner() or is_role(array['admin'])
        or is_assigned_to_customer(customer_id)
        or is_delivery_driver(delivery_id))
    with check (is_owner() or is_role(array['admin'])
        or is_assigned_to_customer(customer_id)
        or is_delivery_driver(delivery_id));

-- Consignments are READ-ONLY from the browser. They are written by schedule_delivery
-- (DEFINER) and numbered by the challan worker (service role) — there is no client story
-- for editing one, and inventing a grant for a story that does not exist is how 0026 ended
-- up with `with check (true)`.
alter table delivery_consignments enable row level security;
grant select on delivery_consignments to authenticated;

drop policy if exists delivery_consignments_select on delivery_consignments;
create policy delivery_consignments_select on delivery_consignments for select to authenticated
    using (is_owner() or is_role(array['admin'])
        or is_assigned_to_customer(customer_id)
        or is_delivery_driver(delivery_id));
