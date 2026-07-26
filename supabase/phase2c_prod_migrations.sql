-- Topaz CRM — Phase 2C Production Migration Bundle

create table if not exists deliveries (
    id                    uuid primary key default gen_random_uuid(),
    order_id              uuid not null references orders(id) on delete cascade,
    driver_salesperson_id uuid references salespersons(id),
    status                text not null default 'scheduled' check (status in ('scheduled', 'in_transit', 'delivered', 'failed')),
    scheduled_date        date not null default current_date,
    delivered_at          timestamptz,
    vehicle_no            text,
    eway_bill_no          text,
    notes                 text,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

create table if not exists delivery_items (
    id            uuid primary key default gen_random_uuid(),
    delivery_id   uuid not null references deliveries(id) on delete cascade,
    order_item_id uuid not null references order_items(id) on delete cascade,
    created_at    timestamptz not null default now(),
    constraint delivery_items_unique_pair unique (delivery_id, order_item_id)
);

create index if not exists deliveries_order_idx on deliveries (order_id);
create index if not exists deliveries_driver_status_idx on deliveries (driver_salesperson_id, status);

alter table deliveries enable row level security;
alter table delivery_items enable row level security;

create policy deliveries_authenticated_select on deliveries for select to authenticated using (true);
create policy deliveries_authenticated_insert on deliveries for insert to authenticated with check (true);
create policy deliveries_authenticated_update on deliveries for update to authenticated using (true);

create policy delivery_items_authenticated_select on delivery_items for select to authenticated using (true);
create policy delivery_items_authenticated_insert on delivery_items for insert to authenticated with check (true);

-- ─── 0027 · Job Cards + Media Entities ─────────────────────────────────────────
alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check
    check (kind in ('quotation_pdf', 'receipt_pdf', 'invoice_pdf', 'job_card_pdf', 'job_card_image'));

alter table media drop constraint if exists media_entity_type_check;
alter table media add constraint media_entity_type_check
    check (entity_type in ('customer', 'order', 'order_item', 'production_event',
                           'delivery', 'product', 'quotation_item'));

alter table products add column if not exists primary_media_id uuid references media(id) on delete set null;
alter table quotation_items add column if not exists spec_notes text;
alter table order_items     add column if not exists spec_notes text;

create index if not exists documents_entity_kind_version_idx
    on documents (entity_type, entity_id, kind, version desc);

-- ─── 0029 · Workshop Staff Hierarchy ──────────────────────────────────────────
create table if not exists workshop_staff (
    id             uuid primary key default gen_random_uuid(),
    workshop_id    uuid not null references workshops(id),
    salesperson_id uuid not null references salespersons(id),
    role           text not null check (role in ('lead', 'sub')),
    active         boolean not null default true,
    created_by     uuid references salespersons(id),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    deactivated_at timestamptz
);

create unique index if not exists workshop_staff_one_active_lead
    on workshop_staff (workshop_id) where active = true and role = 'lead';

-- ─── 0030 · Route Legs ───────────────────────────────────────────────────────
alter table order_items add column if not exists transit_transfer_id uuid;

create table if not exists route_templates (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    description text,
    active      boolean not null default true,
    created_by  uuid references salespersons(id),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists route_template_legs (
    id                uuid primary key default gen_random_uuid(),
    route_template_id uuid not null references route_templates(id) on delete cascade,
    seq               integer not null check (seq >= 1),
    workshop_id       uuid not null references workshops(id),
    stage_from        text check (stage_from in ('design', 'cutting', 'carving', 'framing', 'sanding', 'polishing', 'upholstery', 'quality_check', 'packing', 'ready_for_dispatch')),
    stage_to          text check (stage_to in ('design', 'cutting', 'carving', 'framing', 'sanding', 'polishing', 'upholstery', 'quality_check', 'packing', 'ready_for_dispatch')),
    expected_days     integer check (expected_days >= 1),
    notes             text,
    created_at        timestamptz not null default now(),
    constraint route_template_legs_unique_seq unique (route_template_id, seq)
);

create table if not exists order_item_route_legs (
    id            uuid primary key default gen_random_uuid(),
    order_item_id uuid not null references order_items(id) on delete cascade,
    seq           integer not null check (seq >= 1),
    workshop_id   uuid not null references workshops(id),
    stage_from    text check (stage_from in ('design', 'cutting', 'carving', 'framing', 'sanding', 'polishing', 'upholstery', 'quality_check', 'packing', 'ready_for_dispatch')),
    stage_to      text check (stage_to in ('design', 'cutting', 'carving', 'framing', 'sanding', 'polishing', 'upholstery', 'quality_check', 'packing', 'ready_for_dispatch')),
    expected_days integer check (expected_days >= 1),
    notes         text,
    created_at    timestamptz not null default now(),
    constraint order_item_route_legs_unique_seq unique (order_item_id, seq)
);

-- ─── 0031 · Workshop Transfers (Mediator App) ─────────────────────────────────
create table if not exists workshop_transfers (
    id                     uuid primary key default gen_random_uuid(),
    transfer_no            text not null unique,
    from_workshop_id       uuid not null references workshops(id),
    to_workshop_id         uuid not null references workshops(id),
    reason                 text not null default 'next_stage'
                           check (reason in ('next_stage', 'rework', 'capacity', 'other')),
    status                 text not null default 'ready'
                           check (status in ('ready', 'picked_up', 'in_transit',
                                             'delivered', 'received', 'cancelled')),
    courier_salesperson_id uuid references salespersons(id),
    vehicle_no             text,
    expected_pickup_at     timestamptz,
    due_at                 timestamptz,
    picked_up_at           timestamptz,
    delivered_at           timestamptz,
    received_at            timestamptz,
    cancelled_at           timestamptz,
    cancel_reason          text,
    notes                  text,
    created_by             uuid references salespersons(id),
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

create table if not exists workshop_transfer_items (
    id            uuid primary key default gen_random_uuid(),
    transfer_id   uuid not null references workshop_transfers(id) on delete cascade,
    order_item_id uuid not null references order_items(id),
    notes         text,
    created_at    timestamptz not null default now(),
    constraint workshop_transfer_items_unique_pair unique (transfer_id, order_item_id)
);
