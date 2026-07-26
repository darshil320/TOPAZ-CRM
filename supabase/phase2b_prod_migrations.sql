-- ════════════════════════════════════════════════════════
-- PHASE 2B PRODUCTION MIGRATIONS (0023 - 0025)
-- Execute this SQL block in the Supabase SQL Editor for your project.
-- ════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════
-- 0023_workshops.sql
-- ════════════════════════════════════════════════════════

create table if not exists workshops (
    id                     uuid primary key default gen_random_uuid(),
    name                   text not null,
    type                   text not null default 'own' check (type in ('own', 'vendor')),
    manager_name           text,
    manager_phone          text,                     -- E.164, mirrors salespersons.whatsapp
    manager_salesperson_id uuid references salespersons(id),
    address                text,
    active                 boolean not null default true,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint workshops_manager_phone_e164 check (
        manager_phone is null or manager_phone ~ '^\+[1-9][0-9]{7,14}$')
);

create unique index if not exists workshops_active_name_uidx
    on workshops (lower(btrim(name))) where active = true;

create index if not exists workshops_manager_idx
    on workshops (manager_salesperson_id) where active = true;

create trigger workshops_set_updated_at
    before update on workshops for each row execute function set_updated_at();

create or replace function is_workshop_manager_of(p_workshop_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from workshops w
        where w.id = p_workshop_id
          and w.active = true
          and w.manager_salesperson_id = current_salesperson_id()
    );
$$;

alter table workshops enable row level security;
grant select, insert, update on workshops to authenticated;

drop policy if exists workshops_select on workshops;
create policy workshops_select on workshops for select to authenticated
    using (true);

drop policy if exists workshops_insert on workshops;
create policy workshops_insert on workshops for insert to authenticated
    with check (is_owner() or is_role(array['admin']));

drop policy if exists workshops_update on workshops;
create policy workshops_update on workshops for update to authenticated
    using (is_owner() or is_role(array['admin']))
    with check (is_owner() or is_role(array['admin']));


-- ════════════════════════════════════════════════════════
-- 0024_production.sql
-- ════════════════════════════════════════════════════════

create table if not exists production_stage_defs (
    code           text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
    sort           int  not null unique,
    label_en       text not null,
    label_gu       text,
    photo_required boolean not null default false,
    active         boolean not null default true
);

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
on conflict (code) do nothing;

alter table production_stage_defs enable row level security;
grant select, insert, update on production_stage_defs to authenticated;

drop policy if exists stage_defs_select on production_stage_defs;
create policy stage_defs_select on production_stage_defs for select to authenticated
    using (true);

drop policy if exists stage_defs_write on production_stage_defs;
create policy stage_defs_write on production_stage_defs for all to authenticated
    using (is_owner() or is_role(array['admin']))
    with check (is_owner() or is_role(array['admin']));

alter table order_items
    add column if not exists current_stage      text references production_stage_defs(code),
    add column if not exists current_stage_at   timestamptz,
    add column if not exists workshop_id        uuid references workshops(id),
    add column if not exists blocked            boolean not null default false,
    add column if not exists blocked_at         timestamptz,
    add column if not exists production_done_at timestamptz;

create index if not exists order_items_workshop_idx
    on order_items (workshop_id) where workshop_id is not null;

create index if not exists order_items_stage_idx
    on order_items (current_stage) where current_stage is not null;

create index if not exists order_items_blocked_idx
    on order_items (blocked) where blocked = true;

create table if not exists order_item_assignments (
    id             uuid primary key default gen_random_uuid(),
    order_item_id  uuid not null references order_items(id) on delete cascade,
    workshop_id    uuid not null references workshops(id),
    allocated_by   uuid references salespersons(id),
    allocated_at   timestamptz not null default now(),
    active         boolean not null default true,
    deallocated_at timestamptz
);

create unique index if not exists order_item_assignments_active_uidx
    on order_item_assignments (order_item_id) where active = true;

create index if not exists order_item_assignments_workshop_idx
    on order_item_assignments (workshop_id) where active = true;

alter table order_item_assignments enable row level security;
grant select on order_item_assignments to authenticated;

drop policy if exists oia_select on order_item_assignments;
create policy oia_select on order_item_assignments for select to authenticated
    using (
        is_owner()
        or is_role(array['admin', 'accounts'])
        or is_workshop_manager_of(workshop_id)
        or exists (
            select 1 from order_items oi
            join customers c on c.id = (
                select customer_id from orders where id = oi.order_id
            )
            where oi.id = order_item_assignments.order_item_id
              and is_assigned_to_customer(c.id)
        )
    );

create table if not exists production_events (
    id            uuid primary key default gen_random_uuid(),
    order_item_id uuid not null references order_items(id) on delete cascade,
    event_type    text not null check (event_type in ('done', 'blocked', 'unblocked', 'override')),
    stage_code    text references production_stage_defs(code),
    media_id      uuid,
    note          text,
    actor_id      uuid references salespersons(id),
    created_at    timestamptz not null default now(),
    constraint production_events_done_has_stage check (
        event_type <> 'done' or stage_code is not null),
    constraint production_events_block_has_note check (
        event_type <> 'blocked' or (note is not null and btrim(note) <> ''))
);

create index if not exists production_events_item_idx
    on production_events (order_item_id, created_at desc);

create unique index if not exists production_events_one_done_per_stage
    on production_events (order_item_id, stage_code)
    where event_type = 'done';

create or replace function forbid_production_event_mutation()
returns trigger language plpgsql as $$
begin
    raise exception 'production_events is append-only — UPDATE and DELETE are forbidden';
end;
$$;

drop trigger if exists production_events_no_update on production_events;
create trigger production_events_no_update
    before update on production_events for each row execute function forbid_production_event_mutation();

drop trigger if exists production_events_no_delete on production_events;
create trigger production_events_no_delete
    before delete on production_events for each row execute function forbid_production_event_mutation();

alter table production_events enable row level security;
grant select on production_events to authenticated;

drop policy if exists pe_select on production_events;
create policy pe_select on production_events for select to authenticated
    using (
        is_owner()
        or is_role(array['admin', 'accounts'])
        or exists (
            select 1 from order_items oi
            where oi.id = production_events.order_item_id
              and is_workshop_manager_of(oi.workshop_id)
        )
        or exists (
            select 1 from order_items oi
            join orders o on o.id = oi.order_id
            where oi.id = production_events.order_item_id
              and is_assigned_to_customer(o.customer_id)
        )
    );

create or replace function sync_order_item_workshop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if (TG_OP = 'DELETE') then
        update order_items set workshop_id = null where id = OLD.order_item_id;
        return OLD;
    end if;

    if (NEW.active = true) then
        update order_items set workshop_id = NEW.workshop_id where id = NEW.order_item_id;
    else
        update order_items
           set workshop_id = (
               select workshop_id from order_item_assignments
                where order_item_id = NEW.order_item_id and active = true limit 1
           )
         where id = NEW.order_item_id;
    end if;

    return NEW;
end;
$$;

drop trigger if exists sync_order_item_workshop_trig on order_item_assignments;
create trigger sync_order_item_workshop_trig
    after insert or update or delete on order_item_assignments
    for each row execute function sync_order_item_workshop();

create or replace function production_events_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_current          text;
    v_item_done        timestamptz;
    v_next             text;
    v_order_id         uuid;
    v_order_status     text;
    v_uncomplete_count int;
begin
    select oi.current_stage, oi.production_done_at, oi.order_id, o.status
      into v_current, v_item_done, v_order_id, v_order_status
      from order_items oi
      join orders o on o.id = oi.order_id
     where oi.id = NEW.order_item_id;

    if v_current is null then
        return NEW;
    end if;

    if NEW.event_type = 'blocked' then
        update order_items
           set blocked = true, blocked_at = NEW.created_at
         where id = NEW.order_item_id;
        return NEW;
    elsif NEW.event_type = 'unblocked' then
        update order_items
           set blocked = false, blocked_at = null
         where id = NEW.order_item_id;
        return NEW;
    end if;

    if NEW.event_type <> 'done' then
        return NEW;
    end if;

    if v_item_done is not null then
        return NEW;
    end if;

    select code into v_next
      from production_stage_defs
     where active = true
       and sort > (select sort from production_stage_defs where code = NEW.stage_code)
     order by sort asc
     limit 1;

    if v_next is not null then
        update order_items
           set current_stage = v_next,
               current_stage_at = NEW.created_at,
               blocked = false,
               blocked_at = null
         where id = NEW.order_item_id
           and (current_stage is null or (
                   select sort from production_stage_defs where code = current_stage
               ) <= (select sort from production_stage_defs where code = NEW.stage_code));
    else
        update order_items
           set production_done_at = NEW.created_at,
               current_stage_at   = NEW.created_at,
               blocked            = false,
               blocked_at         = null
         where id = NEW.order_item_id
           and production_done_at is null;
    end if;

    if v_order_status = 'confirmed' then
        update orders
           set status = 'in_production', updated_at = now()
         where id = v_order_id and status = 'confirmed';
    end if;

    if v_order_status in ('confirmed', 'in_production') then
        select count(*) into v_uncomplete_count
          from order_items
         where order_id = v_order_id
           and production_done_at is null;

        if v_uncomplete_count = 0 then
            update orders
               set status = 'ready', updated_at = now()
             where id = v_order_id and status in ('confirmed', 'in_production');
        end if;
    end if;

    return NEW;
end;
$$;

drop trigger if exists production_events_apply_trig on production_events;
create trigger production_events_apply_trig
    after insert on production_events
    for each row execute function production_events_apply();


-- ════════════════════════════════════════════════════════
-- 0025_media.sql
-- ════════════════════════════════════════════════════════

create table if not exists media (
    id          uuid primary key default gen_random_uuid(),
    entity_type text not null check (entity_type in
                    ('customer', 'order', 'order_item', 'production_event', 'delivery')),
    entity_id   uuid not null,
    kind        text not null check (kind in
                    ('reference', 'drawing', 'site', 'production', 'finished', 'delivery')),
    constraint media_site_is_customer_scoped check (
        kind <> 'site' or entity_type = 'customer'),
    storage_key text not null unique,
    thumb_key   text,
    mime        text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
    bytes       int check (bytes is null or bytes > 0),
    status      text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
    created_by  uuid references salespersons(id),
    created_at  timestamptz not null default now(),
    uploaded_at timestamptz
);

create index if not exists media_entity_idx
    on media (entity_type, entity_id, created_at desc);

create index if not exists media_pending_idx
    on media (created_at) where status = 'pending';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'production_events_media_id_fkey'
          and conrelid = 'production_events'::regclass
    ) then
        alter table production_events
            add constraint production_events_media_id_fkey
            foreign key (media_id) references media(id) on delete restrict;
    end if;
end $$;

create index if not exists production_events_media_idx
    on production_events (media_id) where media_id is not null;

alter table media enable row level security;
grant select on media to authenticated;

drop policy if exists media_select on media;
create policy media_select on media for select to authenticated
    using (entity_type <> 'customer'
        or not is_role(array['workshop_manager', 'delivery']));
