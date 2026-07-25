-- ════════════════════════════════════════════════════════
-- 0011_roles.sql
-- ════════════════════════════════════════════════════════
-- Topaz CRM — 0011 · role expansion + is_role() helper (Phase 2A foundation)
-- Expands salespersons.role from ('salesperson','owner') to the full Phase 2 staff
-- taxonomy and adds a set-membership RLS helper mirroring is_owner() (0004).
-- Additive: existing 'salesperson'/'owner' rows stay valid; no data rewritten.
-- ════════════════════════════════════════════════════════════════════════════

alter table salespersons drop constraint if exists salespersons_role_check;
alter table salespersons add constraint salespersons_role_check
    check (role in ('salesperson', 'owner', 'admin', 'accounts', 'workshop_manager', 'delivery'));

-- True if the current auth user's (active) salesperson role is any of the supplied
-- roles. SECURITY DEFINER so it reads salespersons regardless of RLS — same trust
-- model as is_owner()/current_salesperson_id() (0004). Callers pass a literal array,
-- e.g. is_role(array['admin','accounts']); never user input.
create or replace function is_role(roles text[])
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from salespersons
        where auth_uid = (select auth.uid())
          and role = any(roles)
          and active = true
    );
$$;

comment on function is_role(text[]) is
    'Phase 2 RLS helper: true if the current user''s salesperson role is in the given set.';

-- ════════════════════════════════════════════════════════
-- 0012_doc_series.sql
-- ════════════════════════════════════════════════════════
-- Topaz CRM — 0012 · document numbering series (Phase 2A foundation)
-- Gap-tolerant, collision-free document numbering for quotations/orders/receipts.
-- Series are per fiscal year (Apr–Mar), e.g. QTN-2627-0001. The fiscal-year string
-- is computed in the Python numbering service, never in SQL (PLAN.md decision 5).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists doc_series (
    series      text not null,          -- 'QTN' | 'ORD' | 'RCP'
    fiscal_year text not null,          -- '2627' (FY 2026-27)
    last_no     int  not null default 0,
    primary key (series, fiscal_year)
);

-- Atomic allocator: upserts the (series, fy) row and returns the freshly
-- incremented number in a single statement. The ON CONFLICT DO UPDATE takes a row
-- lock, so concurrent callers serialise and never receive the same number.
-- Uniqueness is the ONLY guarantee — a rolled-back caller burns a number (gaps are
-- acceptable and expected). Never MAX()+1 (race) — PLAN.md decision 5.
create or replace function allocate_number(p_series text, p_fy text)
returns int language sql as $$
    insert into doc_series (series, fiscal_year, last_no)
    values (p_series, p_fy, 1)
    on conflict (series, fiscal_year)
    do update set last_no = doc_series.last_no + 1
    returning last_no;
$$;

comment on function allocate_number(text, text) is
    'Atomically allocate the next number for (series, fiscal_year). Unique, gap-tolerant.';

-- Numbering runs server-side only (FastAPI/Celery via the service role); no
-- authenticated/anon grants — the browser never allocates a number directly.

-- ════════════════════════════════════════════════════════
-- 0013_products.sql
-- ════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════
-- 0014_quotations.sql
-- ════════════════════════════════════════════════════════
-- Topaz CRM — 0014 · quotations + quotation_items (Phase 2A)
-- A quotation is a GST-computed offer to a customer. Revisions are NEW rows
-- (revision_of points at the prior row, which is frozen); the UI shows the chain.
-- All money is NUMERIC(12,2); totals are computed server-side (gst.py), never
-- trusted from the client (PLAN.md decision 1). approval_token gates the public
-- customer approval page (module 03).
-- ════════════════════════════════════════════════════════════════════════════

-- Shared status-change auditor (reused by orders in 0015). DB-level single source
-- for status transitions; API-layer audit covers non-status actions (create/send).
create or replace function audit_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
        insert into audit_log (entity, entity_id, action, actor, payload)
        values (tg_table_name, new.id,
                'status:' || old.status || '->' || new.status,
                coalesce(current_salesperson_id()::text, 'system'),
                jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    return new;
end;
$$;

create table if not exists quotations (
    id              uuid primary key default gen_random_uuid(),
    quote_no        text unique not null,
    customer_id     uuid not null references customers(id),
    status          text not null default 'draft'
                        check (status in ('draft', 'sent', 'viewed', 'approved', 'rejected', 'expired')),
    revision_of     uuid references quotations(id),
    revision_no     int not null default 1,
    valid_until     date,
    place_of_supply text not null default 'GJ',
    subtotal        numeric(12,2) not null default 0,
    discount_amount numeric(12,2) not null default 0,
    taxable_value   numeric(12,2) not null default 0,
    cgst            numeric(12,2) not null default 0,
    sgst            numeric(12,2) not null default 0,
    igst            numeric(12,2) not null default 0,
    grand_total     numeric(12,2) not null default 0,
    terms           text,
    notes           text,
    approval_token  uuid unique not null default gen_random_uuid(),
    approved_at     timestamptz,
    approved_ip     text,
    pdf_key         text,
    created_by      uuid references salespersons(id),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists quotations_customer_idx  on quotations (customer_id);
create index if not exists quotations_status_idx     on quotations (status);
create index if not exists quotations_revision_idx    on quotations (revision_of);

create table if not exists quotation_items (
    id            uuid primary key default gen_random_uuid(),
    quotation_id  uuid not null references quotations(id) on delete cascade,
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
    line_total    numeric(12,2) not null,      -- qty * unit_price (pre-tax), server-computed
    sort          int not null default 0
);

create index if not exists quotation_items_quotation_idx on quotation_items (quotation_id);

create trigger quotations_set_updated_at
    before update on quotations for each row execute function set_updated_at();
create trigger quotations_audit_status
    after update on quotations for each row execute function audit_status_change();

-- ─── RLS: sales see quotes of their assigned customers; accounts + owner/admin read
-- all; owner/admin + assigned sales write. Accounts is read-only on quotations.
alter table quotations     enable row level security;
alter table quotation_items enable row level security;
grant select, insert, update, delete on quotations      to authenticated;
grant select, insert, update, delete on quotation_items to authenticated;

create policy q_select on quotations for select to authenticated
    using (is_owner() or is_role(array['admin', 'accounts']) or is_assigned_to_customer(customer_id));
create policy q_insert on quotations for insert to authenticated
    with check (is_owner() or is_role(array['admin']) or is_assigned_to_customer(customer_id));
create policy q_update on quotations for update to authenticated
    using (is_owner() or is_role(array['admin']) or is_assigned_to_customer(customer_id))
    with check (is_owner() or is_role(array['admin']) or is_assigned_to_customer(customer_id));
create policy q_delete on quotations for delete to authenticated
    using (is_owner() or is_role(array['admin']) or is_assigned_to_customer(customer_id));

-- Items inherit their parent quotation's visibility/writability.
create policy qi_select on quotation_items for select to authenticated
    using (exists (select 1 from quotations q where q.id = quotation_id
        and (is_owner() or is_role(array['admin', 'accounts']) or is_assigned_to_customer(q.customer_id))));
create policy qi_write on quotation_items for all to authenticated
    using (exists (select 1 from quotations q where q.id = quotation_id
        and (is_owner() or is_role(array['admin']) or is_assigned_to_customer(q.customer_id))))
    with check (exists (select 1 from quotations q where q.id = quotation_id
        and (is_owner() or is_role(array['admin']) or is_assigned_to_customer(q.customer_id))));

-- ════════════════════════════════════════════════════════
-- 0015_orders.sql
-- ════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════
-- 0016_payments.sql
-- ════════════════════════════════════════════════════════
-- Topaz CRM — 0016 · payments + payment_schedules + order_outstanding (Phase 2A)
-- Payments are IMMUTABLE after insert (PLAN.md decision 11): no UPDATE/DELETE, ever.
-- Corrections are new 'refund' reversal rows. Outstanding is derived, never stored.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists payments (
    id           uuid primary key default gen_random_uuid(),
    receipt_no   text unique not null,
    order_id     uuid not null references orders(id),
    customer_id  uuid not null references customers(id),
    kind         text not null check (kind in ('advance', 'stage', 'final', 'refund')),
    amount       numeric(12,2) not null check (amount > 0),
    mode         text not null check (mode in ('cash', 'upi', 'bank', 'cheque', 'card')),
    reference    text,
    paid_at      timestamptz not null,
    recorded_by  uuid references salespersons(id),
    notes        text,
    created_at   timestamptz not null default now()
    -- NO updated_at: rows are immutable (see forbid_payment_mutation below).
);

create index if not exists payments_order_idx    on payments (order_id);
create index if not exists payments_customer_idx  on payments (customer_id);

-- Hard immutability: block UPDATE/DELETE for everyone, including the service role.
-- The ONLY correction path is inserting a 'refund' row.
create or replace function forbid_payment_mutation()
returns trigger language plpgsql as $$
begin
    raise exception 'payments are immutable; record a refund/reversal row instead'
        using errcode = 'insufficient_privilege';
end;
$$;
create trigger payments_immutable
    before update or delete on payments
    for each row execute function forbid_payment_mutation();

create table if not exists payment_schedules (
    id         uuid primary key default gen_random_uuid(),
    order_id   uuid not null references orders(id) on delete cascade,
    label      text,
    due_date   date not null,
    amount     numeric(12,2) not null,
    status     text not null default 'pending' check (status in ('pending', 'due', 'paid', 'waived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists payment_schedules_order_idx on payment_schedules (order_id);
create index if not exists payment_schedules_due_idx    on payment_schedules (due_date) where status = 'pending';

create trigger payment_schedules_set_updated_at
    before update on payment_schedules for each row execute function set_updated_at();

-- Derived outstanding per order: paid = Σ non-refund − Σ refund. security_invoker so
-- RLS on orders/payments applies AS THE QUERYING USER (a salesperson only sees their
-- own customers' rows). Requires Postgres 15+ (Supabase prod parity).
create or replace view order_outstanding with (security_invoker = true) as
    select o.id          as order_id,
           o.grand_total,
           coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0) as paid,
           o.grand_total
             - coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0) as outstanding
    from orders o
    left join payments p on p.order_id = o.id
    group by o.id, o.grand_total;

-- ─── RLS: accounts + owner/admin manage; sales read own customers' payments.
alter table payments          enable row level security;
alter table payment_schedules enable row level security;
-- Payments: SELECT + INSERT only (immutability also enforced by trigger above).
grant select, insert on payments to authenticated;
grant select, insert, update, delete on payment_schedules to authenticated;
grant select on order_outstanding to authenticated;

create policy pay_select on payments for select to authenticated
    using (is_owner() or is_role(array['admin', 'accounts']) or is_assigned_to_customer(customer_id));
create policy pay_insert on payments for insert to authenticated
    with check (is_owner() or is_role(array['admin', 'accounts']));

create policy sched_select on payment_schedules for select to authenticated
    using (is_owner() or is_role(array['admin', 'accounts'])
           or exists (select 1 from orders o where o.id = order_id and is_assigned_to_customer(o.customer_id)));
create policy sched_write on payment_schedules for all to authenticated
    using (is_owner() or is_role(array['admin', 'accounts']))
    with check (is_owner() or is_role(array['admin', 'accounts']));

-- ════════════════════════════════════════════════════════
-- 0017_documents.sql
-- ════════════════════════════════════════════════════════
-- Topaz CRM — 0017 · documents registry (Phase 2A)
-- One row per generated PDF (quotation/receipt/invoice). The bytes live in the
-- private Supabase Storage 'documents' bucket; this table records the key + version.
-- Rows are written by the backend (service role) after a render task; the browser
-- only reads them to build signed-URL links.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists documents (
    id          uuid primary key default gen_random_uuid(),
    kind        text not null check (kind in ('quotation_pdf', 'receipt_pdf', 'invoice_pdf')),
    entity_type text not null,               -- 'quotation' | 'order' | 'payment'
    entity_id   uuid not null,
    storage_key text not null,
    version     int not null default 1,
    created_at  timestamptz not null default now()
);

create index if not exists documents_entity_idx on documents (entity_type, entity_id);

-- ─── RLS: staff may read the registry (storage bytes stay behind private-bucket
-- signed URLs — the key alone is inert). Writes are service-role only (no grant).
alter table documents enable row level security;
grant select on documents to authenticated;

create policy documents_select on documents for select to authenticated
    using (true);

-- ════════════════════════════════════════════════════════
-- 0018_pipeline_stage_values.sql
-- ════════════════════════════════════════════════════════
-- Topaz CRM — 0018 · pipeline_stage enum: add the Phase 2 granular stages
-- Postgres constraint: a value added to an enum CANNOT be used in the same
-- transaction that added it. Supabase wraps each migration file in one transaction,
-- so the ADD VALUEs live HERE alone; the data migration that USES them is a
-- SEPARATE file (0019). Do not merge these two files.
-- ════════════════════════════════════════════════════════════════════════════

alter type pipeline_stage add value if not exists 'inquiry';
alter type pipeline_stage add value if not exists 'contacted';
alter type pipeline_stage add value if not exists 'visit_scheduled';
alter type pipeline_stage add value if not exists 'walk_in';
alter type pipeline_stage add value if not exists 'design_discussion';
alter type pipeline_stage add value if not exists 'quotation_sent';
alter type pipeline_stage add value if not exists 'negotiation';
alter type pipeline_stage add value if not exists 'order_confirmed';

-- Legacy values 'new'/'talking'/'follow_up'/'won'/'lost' remain in the type
-- (Postgres cannot drop enum values). 0019 migrates existing rows off the first
-- four; 'lost' stays as-is. Application code is updated to the new vocabulary.

-- ════════════════════════════════════════════════════════
-- 0019_pipeline_migrate.sql
-- ════════════════════════════════════════════════════════
-- Topaz CRM — 0019 · migrate existing pipeline_stages rows to the new vocabulary
-- Runs AFTER 0018 (separate transaction — the new enum values must be committed
-- before they can be used here). Mapping (spec):
--   new       -> inquiry
--   talking   -> design_discussion
--   follow_up -> negotiation
--   won       -> order_confirmed
--   lost      -> (unchanged)
-- Destructive on live data — apply to staging first, prod only after a verified
-- backup/PITR (see EXECUTION_PLAN §0.2 / §8). Application code (dashboard analytics,
-- StageSelect, owner board, generated types) is updated in the same change.
-- ════════════════════════════════════════════════════════════════════════════

update pipeline_stages set stage = 'inquiry'           where stage = 'new';
update pipeline_stages set stage = 'design_discussion' where stage = 'talking';
update pipeline_stages set stage = 'negotiation'       where stage = 'follow_up';
update pipeline_stages set stage = 'order_confirmed'   where stage = 'won';

-- New rows default to the first real stage of the funnel.
alter table pipeline_stages alter column stage set default 'inquiry';

-- ════════════════════════════════════════════════════════
-- 0020_rls_phase2a.sql
-- ════════════════════════════════════════════════════════
-- Topaz CRM — 0020 · app_settings + Phase 2A RLS completion (module 06)
-- The quote/order/payment RLS policies already ship in 0014-0016. This migration
-- adds the app_settings key/value store (owner/admin-managed config: quote terms,
-- validity, schedule presets, receipt toggle) and asserts the role matrix is
-- complete — workshop_manager/delivery get NO access to money tables (default
-- deny: they appear in no policy's role list), which the RLS test suite proves.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists app_settings (
    key         text primary key,
    value       jsonb not null,
    updated_at  timestamptz not null default now()
);

create trigger app_settings_set_updated_at
    before update on app_settings for each row execute function set_updated_at();

-- ─── RLS: any staff may READ settings (the builder needs default terms/validity);
-- only owner/admin may WRITE (matrix, module 06).
alter table app_settings enable row level security;
grant select, insert, update, delete on app_settings to authenticated;

create policy app_settings_select on app_settings for select to authenticated
    using (true);
create policy app_settings_write on app_settings for all to authenticated
    using (is_owner() or is_role(array['admin']))
    with check (is_owner() or is_role(array['admin']));

-- Seed the defaults the app reads (idempotent). Values mirror config.py fallbacks;
-- an owner can edit them in the admin screen without a deploy.
insert into app_settings (key, value) values
    ('quote_terms', '"50% advance with order confirmation; balance before delivery. Delivery in 4-6 weeks. Prices inclusive of GST as shown."'::jsonb),
    ('quote_validity_days', '15'::jsonb),
    ('default_advance_pct', '50'::jsonb),
    ('send_receipts_to_customer', 'false'::jsonb),
    ('schedule_presets', '[{"label":"Advance","pct":50},{"label":"Before delivery","pct":40},{"label":"On installation","pct":10}]'::jsonb)
on conflict (key) do nothing;

