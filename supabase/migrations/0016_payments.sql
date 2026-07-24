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
