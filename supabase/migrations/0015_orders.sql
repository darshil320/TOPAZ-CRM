-- Topaz CRM — 0015 · orders + order_items (Phase 2A, pure — no production columns)
-- An order is a confirmed sale, optionally converted from an approved quotation.
-- Production columns (current_stage, current_stage_at, workshop_id) are deliberately
-- NOT here — they are added in the 2B production migration so 0015 stays pure 2A.
-- Money mirrors quotations; totals computed server-side (gst.py).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists orders (
    id                     uuid primary key default gen_random_uuid(),
    order_no               text unique not null,
    customer_id            uuid not null references customers(id),
    quotation_id           uuid references quotations(id),
    status                 text not null default 'confirmed'
                               check (status in ('confirmed', 'in_production', 'ready',
                                                 'delivered', 'installed', 'closed', 'cancelled')),
    expected_delivery_date date,
    advance_expected       numeric(12,2) not null default 0,
    subtotal               numeric(12,2) not null default 0,
    discount_amount        numeric(12,2) not null default 0,
    taxable_value          numeric(12,2) not null default 0,
    cgst                   numeric(12,2) not null default 0,
    sgst                   numeric(12,2) not null default 0,
    igst                   numeric(12,2) not null default 0,
    grand_total            numeric(12,2) not null default 0,
    salesperson_id         uuid references salespersons(id),
    notes                  text,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

create index if not exists orders_customer_idx    on orders (customer_id);
create index if not exists orders_status_idx        on orders (status);
create index if not exists orders_quotation_idx     on orders (quotation_id);

create table if not exists order_items (
    id            uuid primary key default gen_random_uuid(),
    order_id      uuid not null references orders(id) on delete cascade,
    product_id    uuid references products(id),
    description   text not null,
    dimensions    text,
    material      text,
    fabric        text,
    polish        text,
    customization text,
    qty           numeric(10,2) not null,
    unit          text,
    unit_price    numeric(12,2) not null,
    hsn           text not null,
    gst_rate      numeric(4,2) not null,
    line_total    numeric(12,2) not null,
    sort          int not null default 0
);

create index if not exists order_items_order_idx on order_items (order_id);

create trigger orders_set_updated_at
    before update on orders for each row execute function set_updated_at();
create trigger orders_audit_status
    after update on orders for each row execute function audit_status_change();

-- ─── RLS mirrors quotations: sales = own customers RW; accounts read all; owner/admin all.
alter table orders      enable row level security;
alter table order_items enable row level security;
grant select, insert, update, delete on orders      to authenticated;
grant select, insert, update, delete on order_items to authenticated;

create policy o_select on orders for select to authenticated
    using (is_owner() or is_role(array['admin', 'accounts']) or is_assigned_to_customer(customer_id));
create policy o_insert on orders for insert to authenticated
    with check (is_owner() or is_role(array['admin']) or is_assigned_to_customer(customer_id));
create policy o_update on orders for update to authenticated
    using (is_owner() or is_role(array['admin']) or is_assigned_to_customer(customer_id))
    with check (is_owner() or is_role(array['admin']) or is_assigned_to_customer(customer_id));
create policy o_delete on orders for delete to authenticated
    using (is_owner() or is_role(array['admin']));

create policy oi_select on order_items for select to authenticated
    using (exists (select 1 from orders o where o.id = order_id
        and (is_owner() or is_role(array['admin', 'accounts']) or is_assigned_to_customer(o.customer_id))));
create policy oi_write on order_items for all to authenticated
    using (exists (select 1 from orders o where o.id = order_id
        and (is_owner() or is_role(array['admin']) or is_assigned_to_customer(o.customer_id))))
    with check (exists (select 1 from orders o where o.id = order_id
        and (is_owner() or is_role(array['admin']) or is_assigned_to_customer(o.customer_id))));
