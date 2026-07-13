-- Topaz CRM — 0008 · per-customer arrival-alert mute
-- Depends on 0002 (customers) and 0004 (protect_customer_owner_fields).
-- Lets the owner silence arrival alerts + AI drafts for known regulars who are
-- not sales leads (staff, family, the water-delivery person, …). Their visits
-- are still recorded for footfall; only the notify/draft dispatch is suppressed.
-- ════════════════════════════════════════════════════════════════════════════

alter table customers
    add column alerts_muted boolean not null default false;

comment on column customers.alerts_muted is
    'Owner-set: when true, arrival (REPEAT) salesperson alerts + AI drafts are '
    'suppressed for this known person (staff/family/regular). Visits still recorded.';

-- Extend the owner-only column guard (0004) so a non-owner salesperson cannot
-- flip the mute — it is a showroom-wide config decision, like the AI toggles.
-- auth.uid() IS NULL ⇒ backend/service role ⇒ trusted, skip the check.
create or replace function protect_customer_owner_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if (select auth.uid()) is not null and not is_owner() then
        if new.ai_followup_enabled is distinct from old.ai_followup_enabled
           or new.ai_autosend is distinct from old.ai_autosend
           or new.alerts_muted is distinct from old.alerts_muted then
            raise exception 'only the owner can change the AI toggles / alert mute'
                using errcode = 'insufficient_privilege';
        end if;
    end if;
    return new;
end;
$$;
