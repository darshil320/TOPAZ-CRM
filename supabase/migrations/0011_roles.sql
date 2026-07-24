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
