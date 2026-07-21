-- Topaz CRM — 0010 · alerts (intent triggers + alert history)
-- Backs M5 "intent trigger detection" and M6B "trigger/alert visibility/history".
-- An alert is written by the backend (service role) when an inbound WhatsApp
-- message trips an intent classifier (call_me / visit / confusion / buying_signal).
-- The assigned primary salesperson is notified on WhatsApp; the owner dashboard
-- shows the live feed + history. Read access mirrors visits: assigned staff see
-- their customers' alerts, the owner sees all. Inserts are service-role only
-- (no authenticated INSERT policy) — same trust model as messages/visits writes.
-- Additive + non-destructive: safe to apply to a live database.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists alerts (
    id             uuid primary key default gen_random_uuid(),
    customer_id    uuid not null references customers(id) on delete cascade,
    salesperson_id uuid references salespersons(id),        -- who was alerted (null = owner/broadcast)
    type           text not null check (type in ('intent_call', 'intent_visit', 'confusion', 'buying_signal')),
    detail         text,                                     -- matched phrase / short context snippet
    message_id     uuid references messages(id) on delete set null,
    created_at     timestamptz not null default now(),
    seen_at        timestamptz
);

create index if not exists alerts_customer_idx on alerts (customer_id);
create index if not exists alerts_created_idx  on alerts (created_at desc);

comment on table alerts is
    'Intent-trigger + alert history (M5/M6B). Written by the backend on inbound '
    'signal detection; primary salesperson notified on WhatsApp, owner sees the feed.';

-- ─── RLS: read = assigned staff or owner; update (mark seen) = same; no auth insert
alter table alerts enable row level security;

create policy alerts_select on alerts for select to authenticated
    using (is_owner() or (customer_id is not null and is_assigned_to_customer(customer_id)));

create policy alerts_update on alerts for update to authenticated
    using (is_owner() or is_assigned_to_customer(customer_id))
    with check (is_owner() or is_assigned_to_customer(customer_id));

-- ─── Realtime: publish INSERTs so the dashboard feed updates live.
-- Guarded so the migration is safe if the publication is absent or already has it.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'alerts'
    ) then
        execute 'alter publication supabase_realtime add table alerts';
    end if;
exception
    when undefined_object then
        null;  -- publication not present in this environment; realtime configured elsewhere
end $$;
