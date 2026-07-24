-- Topaz CRM — 0013 · products (optional catalog, Phase 2A foundation)
-- A light catalog that pre-fills quote/order line items (description, HSN, GST rate,
-- price). Optional by design: quotations work with free-text lines when no catalog
-- exists (STATE.md open question). GST rate + HSN are per-product, never hardcoded
-- at decision points (PLAN.md GST facts).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists products (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    category   text,
    hsn        text not null default '9403',          -- 9401 seating / 9403 other furniture
    gst_rate   numeric(4,2) not null default 18.00,    -- CONFIGURABLE per product; never a literal in logic
    base_price numeric(12,2),
    unit       text default 'nos',
    active     boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists products_active_idx on products (active) where active = true;

create trigger products_set_updated_at
    before update on products for each row execute function set_updated_at();

-- ─── RLS: any staff may read the catalog; only owner/admin may write (matrix, module 06).
alter table products enable row level security;
grant select, insert, update, delete on products to authenticated;

create policy products_select on products for select to authenticated
    using (true);
create policy products_insert on products for insert to authenticated
    with check (is_owner() or is_role(array['admin']));
create policy products_update on products for update to authenticated
    using (is_owner() or is_role(array['admin']))
    with check (is_owner() or is_role(array['admin']));
create policy products_delete on products for delete to authenticated
    using (is_owner() or is_role(array['admin']));
