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
