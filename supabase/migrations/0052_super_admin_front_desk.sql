-- Topaz CRM — 0052 · super_admin, admin-sees-everything, front_desk
--
-- Three changes to who-may-do-what, in one migration because they share helpers:
--
--  1. `super_admin` — every owner power. Done by widening is_owner() to mean
--     "owner-LEVEL" (owner OR super_admin), so the ~40 policies, triggers and SECURITY
--     DEFINER functions that already say is_owner() cover it with no per-policy edit.
--     Only a super_admin may create, change or remove a super_admin row (trigger below).
--  2. `admin` — sees and searches everything an owner sees, and may edit, but removes
--     nothing. New helper can_view_all() replaces is_owner() in the SELECT and the
--     non-destructive INSERT/UPDATE policies of the customer surface. Deletes: a
--     RESTRICTIVE "admin never deletes" policy on every table whose permissive delete
--     (or FOR ALL) policy admitted admin; soft deletes done as UPDATEs are refused by the
--     refuse_admin_removal trigger. Kept owner-only on purpose: staff management
--     (sp_owner_manage), consent withdrawal (purges biometrics), deactivating an
--     assignment (ca_update), the AI/mute toggles and consent_id.
--  3. `front_desk` — the dispatcher: sees every customer and quotation, ASSIGNS a
--     walk-in to a salesperson (from the kiosk or the front desk board), and prepares
--     quotations on a salesperson's behalf. All of its WRITES go through the API (service
--     role), where authz.py gates them; here it only gains reads. It does not CLAIM.
--
-- The walk-in queue itself is unchanged (0007): every unclaimed walk-in is in every
-- salesperson's queue and any of them may claim it. A walk-in the front desk assigns
-- simply leaves the queue, because it now has a primary.
--
-- ALTER POLICY where the policy already exists, so no table is ever briefly without
-- one (same rule as 0044). Every helper call is wrapped `(select …)` so it hoists to
-- one InitPlan per statement (0044).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Roles ────────────────────────────────────────────────────────────────
alter table salespersons drop constraint if exists salespersons_role_check;
alter table salespersons add constraint salespersons_role_check
    check (role in ('salesperson', 'owner', 'admin', 'accounts', 'workshop_manager',
                    'delivery', 'telecaller', 'super_admin', 'front_desk'));

-- ─── 2. Helpers ──────────────────────────────────────────────────────────────
-- Same trust model as 0004's is_owner(): SECURITY DEFINER, reads salespersons past
-- its RLS, scoped to the caller's own auth.uid().
create or replace function is_owner()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from salespersons
        where auth_uid = (select auth.uid())
          and role in ('owner', 'super_admin')
          and active = true
    );
$$;
comment on function is_owner() is
    'Owner-LEVEL (owner or super_admin), active. Every "owner may" rule means this (0052).';

create or replace function can_view_all()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from salespersons
        where auth_uid = (select auth.uid())
          and role in ('owner', 'super_admin', 'admin')
          and active = true
    );
$$;
comment on function can_view_all() is
    'Owner-level or admin, active: sees (and may edit) the whole customer surface (0052).';

create or replace function is_dispatcher()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from salespersons
        where auth_uid = (select auth.uid())
          and role in ('owner', 'super_admin', 'admin', 'front_desk')
          and active = true
    );
$$;
comment on function is_dispatcher() is
    'Owner-level, admin or front_desk, active: sees every customer, assigns walk-ins (0052).';

-- True when the customer's consent was withdrawn. SECURITY DEFINER like 0007's
-- customer_has_active_primary(): callers (claim_customer, unclaimed_walkins) must not
-- depend on whether the CALLER may read `consents`.
create or replace function customer_consent_withdrawn(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from customers c join consents co on co.id = c.consent_id
        where c.id = p_customer_id and co.withdrawn_at is not null
    );
$$;

-- ─── 3. Quotations prepared on a salesperson's behalf ────────────────────────
-- created_by stays "whose quotation this is" (lists, filters, order attribution);
-- prepared_by is who actually built it when that was someone else (front desk).
alter table quotations
    add column if not exists prepared_by uuid references salespersons(id) on delete set null;

-- ─── 4. Policies: customer surface ───────────────────────────────────────────
alter policy cust_select on customers
    using ((select is_dispatcher()) or id in (select my_assigned_customer_ids()));
alter policy cust_update on customers
    using ((select can_view_all()) or id in (select my_assigned_customer_ids()))
    with check ((select can_view_all()) or id in (select my_assigned_customer_ids()));

alter policy visits_select on visits
    using ((select can_view_all())
        or (customer_id is not null and customer_id in (select my_assigned_customer_ids())));

alter policy ca_select on customer_assignments
    using ((select is_dispatcher())
        or salesperson_id = (select current_salesperson_id())
        or customer_id in (select my_assigned_customer_ids()));
alter policy ca_insert on customer_assignments
    with check ((select can_view_all()));

alter policy consent_select on consents
    using ((select can_view_all()) or exists (
        select 1 from customers c
        where c.consent_id = consents.id
          and c.id in (select my_assigned_customer_ids())));

alter policy conv_select on conversations
    using ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));
alter policy conv_insert on conversations
    with check ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));
alter policy conv_update on conversations
    using ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()))
    with check ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));

alter policy pipe_select on pipeline_stages
    using ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));
alter policy pipe_insert on pipeline_stages
    with check ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));
alter policy pipe_update on pipeline_stages
    using ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()))
    with check ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));

alter policy msg_select on messages
    using ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));
alter policy msg_insert on messages
    with check ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));
alter policy msg_update on messages
    using ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()))
    with check ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));

alter policy fu_select on followups
    using ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));

alter policy audit_owner_select on audit_log using ((select can_view_all()));

alter policy alerts_select on alerts
    using ((select can_view_all())
        or (customer_id is not null and customer_id in (select my_assigned_customer_ids())));
alter policy alerts_update on alerts
    using ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()))
    with check ((select can_view_all()) or customer_id in (select my_assigned_customer_ids()));

alter policy cov_select on coverage_requests
    using ((select can_view_all())
        or requested_by = (select current_salesperson_id())
        or claimed_by = (select current_salesperson_id())
        or customer_id in (select my_assigned_customer_ids()));

-- Staff directory: dispatchers need every name for the salesperson pickers. Managing
-- staff stays owner-level (sp_owner_manage, unchanged).
alter policy sp_select_self_or_owner on salespersons
    using (auth_uid = (select auth.uid()) or (select is_dispatcher()));

-- ─── 5. Policies: quotations — front desk reads every quote ──────────────────
alter policy q_select on quotations
    using ((select is_owner()) or (select is_role(array['admin', 'accounts', 'front_desk']))
        or customer_id in (select my_assigned_customer_ids()));
alter policy qi_select on quotation_items
    using (exists (select 1 from quotations q where q.id = quotation_id
        and ((select is_owner()) or (select is_role(array['admin', 'accounts', 'front_desk']))
             or q.customer_id in (select my_assigned_customer_ids()))));

-- ─── 6. Admin never deletes ──────────────────────────────────────────────────
-- RESTRICTIVE: AND-ed with the existing permissive policies, so it removes admin from
-- DELETE and changes nothing for any other role. One per table whose permissive
-- delete or FOR ALL policy admitted admin.
create policy quotations_admin_no_delete on quotations as restrictive
    for delete to authenticated using (not (select is_role(array['admin'])));
create policy quotation_items_admin_no_delete on quotation_items as restrictive
    for delete to authenticated using (not (select is_role(array['admin'])));
create policy orders_admin_no_delete on orders as restrictive
    for delete to authenticated using (not (select is_role(array['admin'])));
create policy order_items_admin_no_delete on order_items as restrictive
    for delete to authenticated using (not (select is_role(array['admin'])));
create policy payment_schedules_admin_no_delete on payment_schedules as restrictive
    for delete to authenticated using (not (select is_role(array['admin'])));
create policy products_admin_no_delete on products as restrictive
    for delete to authenticated using (not (select is_role(array['admin'])));
create policy app_settings_admin_no_delete on app_settings as restrictive
    for delete to authenticated using (not (select is_role(array['admin'])));
create policy production_stage_defs_admin_no_delete on production_stage_defs as restrictive
    for delete to authenticated using (not (select is_role(array['admin'])));
create policy production_route_templates_admin_no_delete on production_route_templates
    as restrictive for delete to authenticated using (not (select is_role(array['admin'])));
create policy production_route_template_legs_admin_no_delete on production_route_template_legs
    as restrictive for delete to authenticated using (not (select is_role(array['admin'])));

-- ─── 7. Claim — unchanged for everyone but the front desk ────────────────────
-- Same rules as 0004: any staff member may claim an unclaimed walk-in, the
-- one_active_primary_per_customer index arbitrates and the loser gets false. Two changes:
--   * the front desk ASSIGNS walk-ins (through the API); it never claims one itself — a
--     claim would make it the primary and hand it the customer's WhatsApp thread.
--   * a salesperson whose old assignment row was deactivated (customer released back to
--     the queue) gets it reactivated as primary — unique (customer_id, salesperson_id)
--     otherwise made their re-claim fail forever as "already claimed".
--   * a customer who withdrew consent cannot be claimed (DPDPA) — 0004 never checked.
create or replace function claim_customer(p_customer_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
    v_sp uuid := current_salesperson_id();
begin
    if v_sp is null then
        raise exception 'no salesperson for current user' using errcode = 'insufficient_privilege';
    end if;
    if is_role(array['front_desk']) then
        raise exception 'the front desk assigns walk-ins; it does not claim them'
            using errcode = 'insufficient_privilege';
    end if;
    if customer_consent_withdrawn(p_customer_id) then
        raise exception 'this customer withdrew their consent' using errcode = 'insufficient_privilege';
    end if;
    insert into customer_assignments (customer_id, salesperson_id, role, active)
    values (p_customer_id, v_sp, 'primary', true)
    on conflict (customer_id, salesperson_id) do update set role = 'primary', active = true;
    return true;                        -- won the claim
exception
    when unique_violation then
        return false;                   -- a primary already exists → "already claimed"
end;
$$;

-- ─── 8. Only a super_admin touches a super_admin row ─────────────────────────
-- sp_owner_manage lets any owner-level user manage staff; without this an owner could
-- demote, deactivate or delete the super_admin above them, or promote themselves.
-- auth.uid() IS NULL ⇒ backend/service role ⇒ trusted, skip (same rule as 0008).
create or replace function protect_super_admin_rows()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if (select auth.uid()) is not null and not is_role(array['super_admin']) then
        if (tg_op in ('UPDATE', 'DELETE') and old.role = 'super_admin')
           or (tg_op in ('INSERT', 'UPDATE') and new.role = 'super_admin') then
            raise exception 'only a super admin can add or change a super admin'
                using errcode = 'insufficient_privilege';
        end if;
    end if;
    return coalesce(new, old);
end;
$$;

drop trigger if exists salespersons_protect_super_admin on salespersons;
create trigger salespersons_protect_super_admin
    before insert or update or delete on salespersons
    for each row execute function protect_super_admin_rows();

-- ─── 9. Admin never soft-deletes either ─────────────────────────────────────
-- Section 6 stops admin's DELETEs, but removal is mostly an UPDATE here: a draft quote
-- goes to 'expired', an order to 'cancelled', a product/workshop/roster row/route
-- template to active = false. RLS cannot tell those from edits, so a trigger refuses
-- exactly those transitions to an admin's own JWT. auth.uid() IS NULL ⇒ service role
-- (the API, which gates admin itself with authz.assert_may_remove) ⇒ skip.
-- Nested IFs on purpose: a record field is only touched on the table that has it.
create or replace function refuse_admin_removal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if (select auth.uid()) is null or not is_role(array['admin']) then
        return new;
    end if;
    if tg_table_name = 'quotations' then
        if new.status = 'expired' and old.status is distinct from 'expired' then
            raise exception 'admins can view and edit but cannot delete a quotation'
                using errcode = 'insufficient_privilege';
        end if;
    elsif tg_table_name = 'orders' then
        if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
            raise exception 'admins can view and edit but cannot cancel an order'
                using errcode = 'insufficient_privilege';
        end if;
    elsif old.active and not new.active then
        raise exception 'admins can view and edit but cannot deactivate anything'
            using errcode = 'insufficient_privilege';
    end if;
    return new;
end;
$$;

drop trigger if exists quotations_refuse_admin_removal on quotations;
create trigger quotations_refuse_admin_removal before update on quotations
    for each row execute function refuse_admin_removal();
drop trigger if exists orders_refuse_admin_removal on orders;
create trigger orders_refuse_admin_removal before update on orders
    for each row execute function refuse_admin_removal();
drop trigger if exists products_refuse_admin_removal on products;
create trigger products_refuse_admin_removal before update on products
    for each row execute function refuse_admin_removal();
drop trigger if exists workshops_refuse_admin_removal on workshops;
create trigger workshops_refuse_admin_removal before update on workshops
    for each row execute function refuse_admin_removal();
drop trigger if exists workshop_staff_refuse_admin_removal on workshop_staff;
create trigger workshop_staff_refuse_admin_removal before update on workshop_staff
    for each row execute function refuse_admin_removal();
drop trigger if exists production_route_templates_refuse_admin_removal on production_route_templates;
create trigger production_route_templates_refuse_admin_removal before update on production_route_templates
    for each row execute function refuse_admin_removal();

-- ─── 10. Consent cannot be forged from a staff JWT ───────────────────────────
-- Admin now edits every customer (cust_update), which with 0005's open
-- consent_auth_insert would let a staff JWT mint a face_tracking consent and re-point a
-- customer at it — the entrance camera would then bind the next face to that person.
-- Biometric consent is only ever the customer's own (kiosk → anon or the API).
alter policy consent_auth_insert on consents with check (not face_tracking);

-- consent_id joins the owner-only customer fields (0008's guard, re-declared whole).
create or replace function protect_customer_owner_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if (select auth.uid()) is not null and not is_owner() then
        if new.ai_followup_enabled is distinct from old.ai_followup_enabled
           or new.ai_autosend is distinct from old.ai_autosend
           or new.alerts_muted is distinct from old.alerts_muted
           or new.consent_id is distinct from old.consent_id then
            raise exception 'only the owner can change the AI toggles, alert mute or consent'
                using errcode = 'insufficient_privilege';
        end if;
    end if;
    return new;
end;
$$;

-- ─── 11. Customer photos are not the front desk's ───────────────────────────
-- Same deny-list as 0025 (production/delivery), plus front_desk: it dispatches walk-ins,
-- it has no use for photos of a customer's home. apps/api media.py mirrors this set.
alter policy media_select on media
    using (entity_type <> 'customer'
        or not (select is_role(array['workshop_manager', 'delivery', 'front_desk'])));

-- ─── 12. Unclaimed walk-ins, filtered in SQL ─────────────────────────────────
-- The front desk's assignment board. Filtering "no active primary" in the browser meant fetching a
-- capped page of customers AND a capped page of assignments and subtracting — past
-- ~1000 claimed customers that showed claimed people as waiting. security_invoker, so
-- the caller's own customers RLS still decides which rows exist for them.
-- Customers who withdrew consent are left out: nobody may claim or be assigned them.
-- That test is customer_consent_withdrawn() (section 2), not a join: under
-- security_invoker a join to `consents` would run the CALLER's consent RLS, which hides an
-- unclaimed customer's consent from salespersons and the front desk — and drop every row.
create or replace view unclaimed_walkins with (security_invoker = true) as
    select id, name, phone, primary_interest, created_at
    from customers
    where not customer_has_active_primary(id)
      and not customer_consent_withdrawn(id);
grant select on unclaimed_walkins to authenticated;
