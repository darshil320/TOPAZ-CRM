-- Topaz CRM — 0029 · workshop staff hierarchy (module 14)
-- A workshop stops having ONE manager (0023's `manager_salesperson_id`) and gains a
-- staff roster: exactly one `lead` plus any number of `sub` managers. The client's
-- ask: "in one workshop there should be submanager as well who handles the status
-- update of the products of that workshop".
--
-- CAPABILITY SPLIT (client-confirmed 2026-07-27, module 14 spec D4):
--   sub  → advance / block / unblock a stage, upload stage photos.   "status updates"
--   lead → all of the above PLUS custody: hand an item over to the next workshop,
--          and receive an incoming consignment.
--
-- WHY NO NEW salespersons.role VALUE (D1): `salespersons.role` is read by is_role()
-- in nearly every policy in this schema and by the dashboard's nav-config. The coarse
-- role stays `workshop_manager` (= which app you land in); workshop_staff.role is the
-- fine-grained capability (= what you may do once you are there). A sub-manager is a
-- `workshop_manager` with a `sub` roster row — zero policy churn, zero nav churn.
--
-- NO MONEY LIVES HERE AND NONE EVER MAY (0023's rule, unchanged).
-- ════════════════════════════════════════════════════════════════════════════

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

-- EXACTLY one active lead per workshop. Mirrors one_active_primary_per_customer
-- (0002) and order_item_assignments_one_active (0024). Sub-managers are unbounded:
-- a two-shift floor legitimately has two or three people ticking stages.
-- CONSEQUENCE: promoting a sub to lead is deactivate-then-insert in ONE transaction,
-- never a bare UPDATE — the API owns that sequence (api/workshops.py).
create unique index if not exists workshop_staff_one_active_lead
    on workshop_staff (workshop_id) where active = true and role = 'lead';

-- No duplicate membership. A person MAY be staff of several workshops (the small-
-- showroom reality: one manager covering two nearby sites), so this is scoped to the
-- pair, not to the person.
create unique index if not exists workshop_staff_one_active_person
    on workshop_staff (workshop_id, salesperson_id) where active = true;

-- Serves the "my workshops" read that runs on EVERY page load of the workshop PWA,
-- and the rewritten is_workshop_manager_of() below (which RLS evaluates per row,
-- per subscriber, on the realtime board — 0024's pe_select warning applies).
create index if not exists workshop_staff_person_idx
    on workshop_staff (salesperson_id) where active = true;

create trigger workshop_staff_set_updated_at
    before update on workshop_staff for each row execute function set_updated_at();

-- ─── Backfill from 0023's single-manager column ───────────────────────────────
-- Idempotent on workshop_staff_one_active_lead: a re-run inserts nothing.
insert into workshop_staff (workshop_id, salesperson_id, role)
select w.id, w.manager_salesperson_id, 'lead'
  from workshops w
 where w.manager_salesperson_id is not null
on conflict do nothing;

-- ─── workshops.manager_salesperson_id becomes a DENORM ────────────────────────
-- Same trade as order_items.workshop_id (0024): two writable copies of "who leads
-- this workshop" would drift, and the drift is load-bearing — the column is read by
-- the allocate modal, the admin tab and module 12's notification recipient lookup.
-- So the DB owns the sync and workshop_staff is the single source of truth.
-- Recomputed from scratch (not copied from NEW) so deactivating a lead without
-- appointing a replacement correctly clears it back to NULL.
create or replace function sync_workshop_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_workshop uuid := coalesce(new.workshop_id, old.workshop_id);
begin
    update workshops
       set manager_salesperson_id = (
               select s.salesperson_id from workshop_staff s
                where s.workshop_id = v_workshop and s.active = true and s.role = 'lead'
                limit 1)
     where id = v_workshop;
    return null;
end;
$$;

create trigger workshop_staff_sync_lead
    after insert or update or delete on workshop_staff
    for each row execute function sync_workshop_lead();

-- ─── RLS helpers ─────────────────────────────────────────────────────────────
-- is_workshop_manager_of() KEEPS ITS NAME AND SIGNATURE on purpose: it is the
-- scoping predicate in oia_select and pe_select (0024) and in module 13's planned
-- money-blind view. Redefining the body instead of adding a differently-named
-- function means sub-managers gain the reads they need — the queue and the realtime
-- event stream — without editing a single existing policy.
--
-- The name now means "is (any-role) STAFF of". Lead-only privileges use
-- is_workshop_lead_of() below. Null-safe: both return false for a null argument.
create or replace function is_workshop_manager_of(p_workshop_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1
          from workshop_staff s
          join workshops w on w.id = s.workshop_id
         where s.workshop_id = p_workshop_id
           and s.active = true
           and w.active = true
           and s.salesperson_id = current_salesperson_id()
    );
$$;

comment on function is_workshop_manager_of(uuid) is
    'Module 14 RLS helper: true if the current user is ACTIVE STAFF (lead or sub) of '
    'the given active workshop. Widened from 0023 single-manager. Lead-only checks '
    'must use is_workshop_lead_of().';

create or replace function is_workshop_lead_of(p_workshop_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1
          from workshop_staff s
          join workshops w on w.id = s.workshop_id
         where s.workshop_id = p_workshop_id
           and s.active = true
           and s.role = 'lead'
           and w.active = true
           and s.salesperson_id = current_salesperson_id()
    );
$$;

comment on function is_workshop_lead_of(uuid) is
    'Module 14 RLS helper: true if the current user is the ACTIVE LEAD of the given '
    'active workshop. Gates custody changes (hand over / receive), never status taps.';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Read-open to authenticated, mirroring workshops (0023): a roster row is a name and
-- a capability word, and the PWA must resolve "which workshops am I staff of" on
-- every load. Writes are owner/admin only — appointing staff is not self-serve, the
-- same call 0005's owner-only ca_insert makes for customer assignments (§19-A.2).
-- No DELETE grant: roster rows are DEACTIVATED so the history of who held a site
-- survives (it is the audit trail behind every stage tap they made).
alter table workshop_staff enable row level security;
grant select, insert, update on workshop_staff to authenticated;

create policy ws_staff_select on workshop_staff for select to authenticated
    using (true);
create policy ws_staff_insert on workshop_staff for insert to authenticated
    with check (is_owner() or is_role(array['admin']));
create policy ws_staff_update on workshop_staff for update to authenticated
    using (is_owner() or is_role(array['admin']))
    with check (is_owner() or is_role(array['admin']));
