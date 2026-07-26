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
