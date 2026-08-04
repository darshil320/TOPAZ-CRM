-- Topaz CRM — 0039 · a delivery is a set of ITEMS, not a whole order
--
-- The client's ask: "let me choose which items go out on this run." The table for it has
-- existed since 0026 — and has never had a single row written to it.
-- `scheduleDeliveryAction` inserts only the `deliveries` row, so every delivery in the
-- system is implicitly "the entire order", and a 5-item order with 3 items finished
-- cannot be part-delivered at all.
--
-- Three things are needed to fix that honestly:
--
--  1. **An atomic write.** deliveries + delivery_items is two INSERTs, and the Supabase
--     client cannot wrap them in one transaction — a failure on the second would leave a
--     delivery with no items, which reads as "the whole order" again: the exact bug.
--     Hence schedule_delivery(), SECURITY INVOKER so 0033's RLS still decides.
--  2. **A per-item guard.** One item must not sit on two open deliveries.
--  3. **Per-item completion.** `order_items.delivered_at`, so "is this order delivered"
--     stops meaning "somebody once marked a delivery done".
-- ════════════════════════════════════════════════════════════════════════════

alter table order_items
    add column if not exists delivered_at timestamptz;

create index if not exists order_items_undelivered_idx
    on order_items (order_id)
    where delivered_at is null;

-- ─── One item, one open delivery ─────────────────────────────────────────────
-- A plain unique index cannot express this: the status that decides whether a delivery
-- is "open" lives on the PARENT row, and a partial index predicate cannot reach it. So
-- the parent's status is denormalised onto the child and indexed — the idiom this schema
-- already uses twice (sync_order_item_workshop 0024, sync_workshop_lead 0029).
alter table delivery_items
    add column if not exists delivery_status text;

-- Backfill before the index exists, or an existing double-booking would fail the CREATE.
update delivery_items di
   set delivery_status = d.status
  from deliveries d
 where d.id = di.delivery_id and di.delivery_status is distinct from d.status;

create or replace function sync_delivery_item_status()
returns trigger language plpgsql as $$
begin
    -- INSERT on the child: copy the parent's current status down.
    if tg_table_name = 'delivery_items' then
        select status into new.delivery_status from deliveries where id = new.delivery_id;
        return new;
    end if;
    -- UPDATE of deliveries.status: push the new status to every child.
    update delivery_items set delivery_status = new.status where delivery_id = new.id;
    return new;
end;
$$;

comment on function sync_delivery_item_status() is
    'Denormalises deliveries.status onto delivery_items so delivery_items_one_open can '
    'be a partial unique index. Pure denorm — it makes no business decision.';

drop trigger if exists delivery_items_sync_status on delivery_items;
create trigger delivery_items_sync_status
    before insert on delivery_items
    for each row execute function sync_delivery_item_status();

drop trigger if exists deliveries_sync_item_status on deliveries;
create trigger deliveries_sync_item_status
    after update of status on deliveries
    for each row execute function sync_delivery_item_status();

-- THE guard. 'delivered' and 'failed' are both CLOSED: a failed run must not lock its
-- items out of being rescheduled, which is the whole reason a run gets marked failed.
create unique index if not exists delivery_items_one_open
    on delivery_items (order_item_id)
    where delivery_status in ('scheduled', 'in_transit');

-- ─── Atomic scheduling from the browser ──────────────────────────────────────
-- SECURITY INVOKER (the default, stated explicitly because it is load-bearing): the
-- caller's own RLS still applies, so 0033's deliveries_insert / delivery_items_insert
-- policies remain the authorization boundary. A DEFINER function here would hand every
-- authenticated user the ability to schedule a delivery on any customer's order.
-- Earlier signatures are DROPPED, not just replaced: `create or replace` only matches an
-- identical argument list, so adding a parameter would leave the previous overload in
-- place — and with defaults on both, a 4-argument call would then be ambiguous and error.
drop function if exists schedule_delivery(uuid, date, uuid, uuid[], text, text, text);
drop function if exists schedule_delivery(uuid, date, uuid, uuid[], text, text, text, text);

create function schedule_delivery(
    p_order_id         uuid,
    p_scheduled_date   date,
    p_driver           uuid,
    p_item_ids         uuid[],
    p_vehicle_no       text default null,
    p_eway_bill_no     text default null,
    p_notes            text default null,
    p_delivery_address text default null,
    -- Both print on the client's challan (0037). Optional: their pad leaves them blank
    -- to be written in by hand, and so does the PDF.
    p_delivery_rent    numeric default null,
    p_dp_code          text default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_id       uuid;
    v_bad_item uuid;
begin
    if array_length(p_item_ids, 1) is null then
        -- Refused rather than defaulted to "all items": an empty selection is an
        -- ambiguous instruction, and guessing it means the whole order is how
        -- part-delivery silently stopped working in the first place.
        raise exception 'Select at least one item to deliver';
    end if;

    -- Every item must belong to the order being delivered. Without this an operator (or
    -- a crafted call — a Server Action is callable RPC) could attach another customer's
    -- item to this run, and the challan would then list goods that are not theirs.
    select requested.id into v_bad_item
      from unnest(p_item_ids) as requested(id)
      left join order_items oi on oi.id = requested.id and oi.order_id = p_order_id
     where oi.id is null
     limit 1;
    if v_bad_item is not null then
        raise exception 'Item % does not belong to this order', v_bad_item;
    end if;

    insert into deliveries (order_id, driver_salesperson_id, scheduled_date,
                            vehicle_no, eway_bill_no, notes, delivery_address,
                            delivery_rent, dp_code, status)
    values (p_order_id, p_driver, coalesce(p_scheduled_date, current_date),
            nullif(btrim(p_vehicle_no), ''), nullif(btrim(p_eway_bill_no), ''),
            nullif(btrim(p_notes), ''), nullif(btrim(p_delivery_address), ''),
            p_delivery_rent, nullif(btrim(p_dp_code), ''), 'scheduled')
    returning id into v_id;

    insert into delivery_items (delivery_id, order_item_id)
    select v_id, item_id from unnest(p_item_ids) as item_id;

    return v_id;
end;
$$;

comment on function schedule_delivery(uuid, date, uuid, uuid[], text, text, text, text, numeric, text) is
    'Creates a delivery and its item lines in ONE transaction. SECURITY INVOKER: 0033''s '
    'RLS policies remain the authorization boundary. Raises on an empty selection, on an '
    'item from another order, and (via delivery_items_one_open) on a double-booked item.';

grant execute on function schedule_delivery(uuid, date, uuid, uuid[], text, text, text, text, numeric, text)
    to authenticated;

-- ─── Completion: per item first, then the order ──────────────────────────────
-- 0033's version moved the ORDER to 'delivered' on the first completed delivery. With
-- part-delivery that is wrong: delivering 3 of 5 items would mark the order delivered and
-- the remaining two would never be dispatched.
--
-- Replaces the function in place (the trigger from 0033 keeps pointing at it), so this
-- migration is additive and needs no trigger drop.
create or replace function on_delivery_completed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_remaining int;
begin
    if new.status = 'delivered' and coalesce(old.status, '') <> 'delivered' then
        -- 1. Stamp the items that actually went out on THIS run.
        update order_items oi
           set delivered_at = coalesce(new.delivered_at, now())
          from delivery_items di
         where di.delivery_id = new.id
           and oi.id = di.order_item_id
           and oi.delivered_at is null;

        -- 2. The order moves only when nothing is left. Mirrors the "all items complete"
        --    check that governs production_done_at (0024).
        select count(*) into v_remaining
          from order_items
         where order_id = new.order_id and delivered_at is null;

        if v_remaining = 0 then
            update orders
               set status = 'delivered', updated_at = now()
             where id = new.order_id
               and status not in ('delivered', 'installed', 'closed', 'cancelled');
        end if;

        insert into audit_log (entity, entity_id, action, actor, payload)
        values ('orders', new.order_id, 'delivered',
                coalesce(current_salesperson_id()::text, 'system'),
                jsonb_build_object('delivery_id', new.id, 'notes', new.notes,
                                   'items_remaining', v_remaining));
    end if;
    return new;
end;
$$;

comment on function on_delivery_completed() is
    'Stamps order_items.delivered_at for the run''s items, then advances orders.status '
    'ONLY when no item of the order is still undelivered (0039). SECURITY DEFINER '
    'because the delivery role has neither privilege directly.';

-- ─── Legacy deliveries have no item rows ─────────────────────────────────────
-- Every delivery created before this migration meant "the whole order". Backfilling
-- their item lines keeps the new per-item completion check truthful for them: without it
-- an already-'delivered' legacy order would show five undelivered items forever, and
-- delivery_items_one_open would happily double-book goods that already left.
insert into delivery_items (delivery_id, order_item_id, delivery_status)
select d.id, oi.id, d.status
  from deliveries d
  join order_items oi on oi.order_id = d.order_id
 where not exists (select 1 from delivery_items di where di.delivery_id = d.id)
on conflict do nothing;

update order_items oi
   set delivered_at = coalesce(d.delivered_at, d.updated_at)
  from delivery_items di
  join deliveries d on d.id = di.delivery_id
 where oi.id = di.order_item_id
   and d.status = 'delivered'
   and oi.delivered_at is null;
