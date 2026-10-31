-- Topaz CRM — 0053 · QR product tags + stock across four locations
--
-- Client request (2026-10-30): every piece of furniture carries a QR sticker. Staff
-- who scan it see the full record — photos, details, sizes, price, GST, stock and
-- where it sits. A CUSTOMER who scans the same sticker sees only the photos, name,
-- description, sizes and other approved details. Stock is managed per location
-- (Bhatar Showroom, Ichhapore Showroom, Godown, Workshop) from the CRM.
--
-- ─── THE CUSTOMER BOUNDARY (strict requirement) ─────────────────────────────
-- "Customers must NEVER be able to view prices, GST or internal locations — not by
-- inspecting the page, changing the URL or calling the API directly." To the database
-- a customer is the `anon` role — or, if they sign in by phone OTP (which creates an
-- auth user for ANY number), an `authenticated` JWT with no staff row. Every catalog
-- policy below requires an ACTIVE staff row, so both see nothing. Three independent
-- layers keep price/GST/location out of their reach; any ONE of them is sufficient:
--   1. `anon` holds NO privilege on products, product_stock, stock_locations,
--      product_prices or product_categories (revoked below — Supabase's stock
--      bootstrap grants anon ALL on every public table, see 0034). With the anon key
--      a direct PostgREST call gets "permission denied", not an empty list.
--   2. RLS: no catalog policy admits anon or a non-staff JWT (products_select is
--      tightened from 0013's `using (true)` below), so even a regranted privilege
--      returns zero rows; product_prices filters on can_view_prices().
--   3. The public QR page never touches Supabase. It calls the API's
--      GET /api/public/products/{code}, whose SQL names an explicit column
--      ALLOWLIST (repositories/product_repo.PUBLIC_COLUMNS) and whose response model
--      cannot carry anything else. Price, GST, HSN, stock and location are not in
--      the query, so they cannot be in the page source either.
--
-- ─── STAFF: "according to their permissions" ────────────────────────────────
--   price + GST + HSN   can_view_prices(): everyone who sells or bills —
--                       owner, super_admin, admin, salesperson, front_desk,
--                       telecaller, accounts. NOT workshop_manager / delivery: a
--                       vendor workshop's manager is an outside party (0027 keeps
--                       prices off the job card for the same reason).
--   stock + locations   can_view_stock(): every active staff role — a driver needs
--                       to know the piece is in the Godown, a workshop manager what
--                       is on the floor.
--   manage              owner-level + admin (VIEW_ALL), through the API.
-- product_prices is the browser's price read path from this migration on. The
-- column-level lockdown that stops a workshop JWT reading products.base_price
-- directly is 0054 (supabase/migrations_pending/) — it must wait until the
-- dashboard that reads product_prices is deployed, or the quote builder breaks.
--
-- ─── QR CODE ────────────────────────────────────────────────────────────────
-- 8 characters of Crockford base32 (no I/L/O/U, so a code read aloud or typed from
-- a scuffed sticker is unambiguous). 40 random bits: the catalog cannot be walked by
-- guessing. Assigned on INSERT and IMMUTABLE afterwards — a printed sticker outlives
-- every edit to the product it points at, which is the point ("updates reflect
-- automatically without changing the QR code").
--
-- Mirrors: apps/api/src/services/roles.py PRICE_VIEW / STOCK_VIEW and
-- apps/dashboard/src/lib/roles.ts (test_role_groups_parity.py keeps all three equal).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Permission helpers ───────────────────────────────────────────────────
-- Same trust model as 0052's helpers: SECURITY DEFINER, reads salespersons past its
-- RLS, scoped to the caller's own auth.uid(), active rows only.
create or replace function can_view_prices()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from salespersons
        where auth_uid = (select auth.uid())
          and role in ('owner', 'super_admin', 'admin', 'salesperson', 'front_desk',
                       'telecaller', 'accounts')
          and active = true
    );
$$;
comment on function can_view_prices() is
    'Active staff who sell or bill: may read product price/GST/HSN (0053).';

create or replace function can_view_stock()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from salespersons
        where auth_uid = (select auth.uid())
          and role in ('owner', 'super_admin', 'admin', 'salesperson', 'front_desk',
                       'telecaller', 'accounts', 'workshop_manager', 'delivery')
          and active = true
    );
$$;
comment on function can_view_stock() is
    'Every active staff role: may read stock quantities and locations (0053).';

-- ─── 2. Stock locations ──────────────────────────────────────────────────────
create table if not exists stock_locations (
    id         uuid primary key default gen_random_uuid(),
    code       text not null unique check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
    name       text not null check (char_length(name) between 1 and 80),
    kind       text not null check (kind in ('showroom', 'godown', 'workshop')),
    sort       int  not null default 0,
    active     boolean not null default true,
    created_at timestamptz not null default now()
);

insert into stock_locations (code, name, kind, sort) values
    ('bhatar_showroom',    'Bhatar Showroom',    'showroom', 10),
    ('ichhapore_showroom', 'Ichhapore Showroom', 'showroom', 20),
    ('godown',             'Godown',             'godown',   30),
    ('workshop',           'Workshop',           'workshop', 40)
on conflict (code) do nothing;

-- ─── 3. Products: customer-facing details, stock status, QR code ─────────────
alter table products
    add column if not exists description  text,
    add column if not exists sizes        text,
    add column if not exists dimensions   text,
    add column if not exists material     text,
    add column if not exists finish       text,
    add column if not exists stock_status text not null default 'in_stock',
    add column if not exists qr_code      text;

alter table products drop constraint if exists products_stock_status_check;
alter table products add constraint products_stock_status_check
    check (stock_status in ('in_stock', 'low_stock', 'out_of_stock', 'made_to_order'));

-- Lengths mirror the API's Pydantic bounds (api/products.py) — the DB is the backstop.
alter table products drop constraint if exists products_text_lengths_check;
alter table products add constraint products_text_lengths_check check (
    char_length(name) between 1 and 200
    and (description is null or char_length(description) <= 4000)
    and (sizes       is null or char_length(sizes)       <= 300)
    and (dimensions  is null or char_length(dimensions)  <= 300)
    and (material    is null or char_length(material)    <= 200)
    and (finish      is null or char_length(finish)      <= 200)
);

-- uuid_send(gen_random_uuid()) is 16 bytes of which bytes 6 and 8 carry the v4
-- version/variant bits — skipped, so every character draws on 5 uniformly random
-- bits (256 is a multiple of 32, so `% 32` adds no bias). No pgcrypto dependency.
create or replace function new_product_qr_code()
returns text language plpgsql volatile set search_path = public as $$
declare
    alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    picks    constant int[] := array[0, 1, 2, 3, 4, 5, 10, 11];
    raw      bytea := uuid_send(gen_random_uuid());
    code     text := '';
    i        int;
begin
    foreach i in array picks loop
        code := code || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
    end loop;
    return code;
end;
$$;

update products set qr_code = new_product_qr_code() where qr_code is null;

alter table products alter column qr_code set not null;
alter table products drop constraint if exists products_qr_code_format;
alter table products add constraint products_qr_code_format
    check (qr_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$');
create unique index if not exists products_qr_code_key on products (qr_code);

-- SECURITY DEFINER so the uniqueness probe sees every product regardless of who is
-- inserting. Retries on the (1-in-a-trillion-per-pair) collision instead of letting
-- the unique index fail the save.
create or replace function products_assign_qr_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        if new.qr_code is null then
            loop
                new.qr_code := new_product_qr_code();
                exit when not exists (select 1 from products where qr_code = new.qr_code);
            end loop;
        end if;
    elsif new.qr_code is distinct from old.qr_code then
        raise exception 'a product''s QR code never changes — printed stickers depend on it'
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

drop trigger if exists products_qr_code on products;
create trigger products_qr_code before insert or update on products
    for each row execute function products_assign_qr_code();

revoke execute on function new_product_qr_code() from public, anon, authenticated;
revoke execute on function products_assign_qr_code() from public, anon, authenticated;

-- Search: category / status filters on the product list. Name search is ILIKE over a
-- catalog of hundreds to low thousands of rows — a seq scan is sub-millisecond there,
-- so no trigram index (and no pg_trgm dependency) until the catalog says otherwise.
create index if not exists products_category_idx on products (category) where active;
create index if not exists products_stock_status_idx on products (stock_status) where active;

-- ─── 4. Stock per (product, location) ────────────────────────────────────────
create table if not exists product_stock (
    product_id  uuid not null references products(id) on delete cascade,
    location_id uuid not null references stock_locations(id) on delete restrict,
    quantity    int  not null default 0 check (quantity between 0 and 100000),
    updated_at  timestamptz not null default now(),
    updated_by  uuid references salespersons(id) on delete set null,
    primary key (product_id, location_id)
);

-- "Products at the Godown": the location filter only ever asks for pieces present.
create index if not exists product_stock_location_idx
    on product_stock (location_id, product_id) where quantity > 0;

create trigger product_stock_set_updated_at
    before update on product_stock for each row execute function set_updated_at();

-- ─── 5. RLS + grants ─────────────────────────────────────────────────────────
-- Stock and locations are READ from the browser and WRITTEN only through the API
-- (api/products.py), which validates the whole product + stock save as one
-- transaction and audits it. So authenticated gets SELECT and nothing else.
alter table stock_locations enable row level security;
alter table product_stock   enable row level security;

revoke all on stock_locations, product_stock from anon, authenticated;
grant select on stock_locations, product_stock to authenticated;

create policy stock_locations_select on stock_locations for select to authenticated
    using ((select can_view_stock()));
create policy product_stock_select on product_stock for select to authenticated
    using ((select can_view_stock()));

-- Price/GST/HSN for the browser. name/unit/active ride along so the quote builder's
-- catalog picker reads this view ALONE — pairing two separately row-capped queries
-- could hand a line the wrong GST rate. Deliberately NOT security_invoker: it runs with the
-- owner's rights so it keeps working once 0054 revokes those columns of `products`
-- from `authenticated`; the WHERE clause is the gate. security_barrier stops a
-- caller-supplied filter function from being pushed below it and seeing rows the
-- gate would have dropped.
create or replace view product_prices with (security_barrier = true) as
    select id as product_id, hsn, gst_rate, base_price, name, unit, active
    from products
    where (select can_view_prices());
comment on view product_prices is
    'Owner-rights view gated by can_view_prices() — the browser''s only price read path (0053).';

-- Distinct categories for the list filter. security_invoker: plain products RLS.
create or replace view product_categories with (security_invoker = true) as
    select distinct category from products where active and category is not null;

revoke all on product_prices, product_categories from anon, authenticated;
grant select on product_prices, product_categories to authenticated;

-- Layer 1 of the customer boundary (header): anon gets nothing on the catalog. The
-- public QR page reads through the API's allowlisted route instead.
revoke all on products from anon;

-- `authenticated` is not the same as "staff". Phone-OTP login creates an auth user for
-- ANY number (signInWithOtp defaults to shouldCreateUser), so a customer can hold an
-- authenticated JWT with no salespersons row. 0013's products_select was
-- `using (true)` — that customer could read products.base_price straight from
-- PostgREST. The catalog is now readable by active staff only; product_categories
-- (security_invoker) inherits this.
alter policy products_select on products using ((select can_view_stock()));

