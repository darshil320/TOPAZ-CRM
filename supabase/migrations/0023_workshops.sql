-- Topaz CRM — 0023 · workshops (Phase 2B "Make" foundation)
-- A workshop is a production site: either Topaz's own floor ('own') or an outside
-- vendor ('vendor'). It is the unit an order_item is ALLOCATED to (0024) and the
-- scope a workshop_manager may see (module 13's money-blind view).
--
-- NO MONEY LIVES HERE AND NONE EVER MAY. Workshop roles are money-blind by design
-- (EXECUTION_PLAN §4 phase success criteria; proven by test_rls in module 13).
--
-- Numbering note: the plan docs say 0014-0016 / 0019-0021 — both ranges were already
-- taken by Phase 1 M5/M6B and 2A. HEAD was 0022, so 2B starts at 0023 (STATE.md).
-- ════════════════════════════════════════════════════════════════════════════

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

-- Two ACTIVE workshops may not share a name: the allocate modal identifies a
-- workshop by name alone, so a duplicate is an operator trap. btrim as well as
-- lower, or ' Sharma ' walks straight past the guard. Partial, so a deactivated
-- workshop's name can be reused.
create unique index if not exists workshops_active_name_uidx
    on workshops (lower(btrim(name))) where active = true;

-- Serves is_workshop_manager_of() and module 09's my-queue (manager → workshops).
create index if not exists workshops_manager_idx
    on workshops (manager_salesperson_id) where active = true;

create trigger workshops_set_updated_at
    before update on workshops for each row execute function set_updated_at();

-- ─── RLS helper: is the current user the (active) manager of this workshop?
-- Mirrors is_assigned_to_customer() (0004). SECURITY DEFINER so it reads workshops
-- regardless of RLS. Null-safe: is_workshop_manager_of(null) = false.
-- Module 13's workshop_items view uses this as its scoping predicate.
create or replace function is_workshop_manager_of(p_workshop_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from workshops w
        where w.id = p_workshop_id
          and w.active = true
          and w.manager_salesperson_id = current_salesperson_id()
    );
$$;

comment on function is_workshop_manager_of(uuid) is
    'Phase 2B RLS helper: true if the current user manages the given active workshop.';

-- ─── RLS mirrors products (0013): any staff may read; only owner/admin may write.
-- Read-open is deliberate — the board, the allocate modal and the PWA all render
-- workshop names, and a name carries no money.
-- No DELETE grant: workshops are DEACTIVATED, never dropped (assignments FK them).
alter table workshops enable row level security;
grant select, insert, update on workshops to authenticated;

create policy workshops_select on workshops for select to authenticated
    using (true);
create policy workshops_insert on workshops for insert to authenticated
    with check (is_owner() or is_role(array['admin']));
create policy workshops_update on workshops for update to authenticated
    using (is_owner() or is_role(array['admin']))
    with check (is_owner() or is_role(array['admin']));

-- ─── Seeding: DELIBERATELY EMPTY.
-- The workshop list is an unanswered client question (STATE.md open questions, 08).
-- Placeholder rows are actively harmful: a fake workshop can receive a real
-- allocation and drive an order to 'ready' against a site that does not exist.
-- The /owner/admin Workshops tab IS the intake mechanism.
--
-- Seed once the client list is confirmed (idempotent on workshops_active_name_uidx):
--   insert into workshops (name, type, manager_name, manager_phone, address) values
--       ('Topaz Main Floor', 'own',    'Suresh', '+919XXXXXXXXX', 'Katargam, Surat'),
--       ('Sharma Furniture', 'vendor', 'Rakesh', '+919XXXXXXXXX', 'Sachin GIDC, Surat')
--   on conflict do nothing;
--
-- manager_salesperson_id is linked AFTERWARDS, once each manager has a salespersons
-- row with role 'workshop_manager' (0011) and has completed a phone-OTP login. It is
-- nullable on purpose: a vendor workshop with no login is still fully allocatable —
-- its items are advanced by an internal admin/owner. Granting a vendor a login later
-- is one UPDATE, never a schema change.
