-- Topaz CRM — 0042 · drop the last of "a delivery belongs to one order"
--
-- ⚠️  DESTRUCTIVE AND IRREVERSIBLE. DO NOT APPLY UNTIL 0041 HAS SOAKED FOR A RELEASE.
--
--     Before running, prove nothing reads these columns any more:
--
--         rg -n 'deliveries\.order_id|"order_id"|d\.challan_no|deliveries.*challan_no' \
--            apps/api/src apps/dashboard/src
--
--     Expected hits: none in a delivery context. `orders.id` joins and
--     `delivery_items.order_id` are the replacements and will not match those patterns.
--
--     `deliveries.order_id` has been a DERIVED, deprecated column since 0040 — written with
--     the run's oldest order purely so pre-0040 readers kept working through the deploy. For
--     a mixed-order run it names one of several orders, so any code still reading it is
--     silently wrong for exactly the scenario this work exists to support. That is why it
--     goes, rather than being left as a harmless convenience.
--
--     The four challan columns moved to `delivery_consignments` in 0040 and were backfilled
--     there. Dropping them here removes the possibility of two disagreeing challan numbers
--     for one run.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── TWO FUNCTIONS TOUCH THE COLUMN AND MUST BE REPLACED FIRST ───────────────
-- Dropping a column out from under a plpgsql function does NOT error at DDL time — it
-- errors the next time somebody schedules or completes a delivery, in production. Both are
-- replaced here, in the same transaction as the DROP.
--
-- 1 · schedule_delivery() writes the deprecated column on every run (0040 §4). Identical to
--     0040's version apart from the INSERT column list: a run has no order.
create or replace function schedule_delivery(p_delivery jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_backend boolean := coalesce((select auth.role()), 'service_role') = 'service_role';
    v_items   uuid[];
    v_id      uuid;
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

    insert into deliveries (driver_salesperson_id, scheduled_date,
                            vehicle_no, eway_bill_no, notes, status)
    values ((p_delivery ->> 'driver_salesperson_id')::uuid,
            coalesce((p_delivery ->> 'scheduled_date')::date, current_date),
            nullif(btrim(p_delivery ->> 'vehicle_no'), ''),
            nullif(btrim(p_delivery ->> 'eway_bill_no'), ''),
            nullif(btrim(p_delivery ->> 'notes'), ''),
            'scheduled')
    returning id into v_id;

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

    insert into delivery_items (delivery_id, order_item_id)
    select v_id, item_id from unnest(v_items) as item_id;

    return v_id;
end;
$$;

-- 2 · on_delivery_completed() has a fallback branch reading `new.order_id` for a pre-0039
--     run with no item rows. That branch cannot survive the column, and does not need to:
--     0039 backfilled item lines for every legacy delivery and 0041 removed every path that
--     could create a delivery without them. The DO block below proves it before the drop.
create or replace function on_delivery_completed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_order record;
begin
    if new.status = 'delivered' and coalesce(old.status, '') <> 'delivered' then
        update delivery_items
           set received_at = coalesce(new.delivered_at, now())
         where delivery_id = new.id and received and received_at is null;

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
        loop
            perform advance_order_after_delivery(v_order.order_id, new.id, new.notes);
        end loop;
    end if;
    return new;
end;
$$;

-- Any legacy delivery that still has no item rows would silently stop closing its order
-- once the fallback is gone. There should be none; fail loudly rather than find out later.
do $$
declare
    v_orphans int;
begin
    select count(*) into v_orphans
      from deliveries d
     where not exists (select 1 from delivery_items di where di.delivery_id = d.id);
    if v_orphans > 0 then
        raise exception
            '% deliveries still have no item rows — run 0039''s backfill before 0042',
            v_orphans;
    end if;
end;
$$;

drop index if exists deliveries_order_idx;

alter table deliveries
    drop column if exists order_id,
    drop column if exists challan_no,
    drop column if exists delivery_address,
    drop column if exists delivery_rent,
    drop column if exists dp_code;
